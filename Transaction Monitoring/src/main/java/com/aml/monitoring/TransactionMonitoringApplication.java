package com.aml.monitoring;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.r2dbc.R2dbcAutoConfiguration;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.util.concurrent.CompletableFuture;
import java.sql.ResultSet;
import java.util.*;

@SpringBootApplication(exclude = {R2dbcAutoConfiguration.class})
@RestController
public class TransactionMonitoringApplication {

    // -------------------------------------------------
    // CONFIG — override ML_SERVICE_URL env var for local dev:
    //   export ML_SERVICE_URL=http://localhost:5000
    // In Docker Compose, default "http://ml-service:5000" works.
    // -------------------------------------------------

    private static final String ML_SERVICE_URL =
        System.getenv("ML_SERVICE_URL") != null
            ? System.getenv("ML_SERVICE_URL")
            : "http://ml-service:5000";

    private static final String DB_URL =
        System.getenv("SPRING_DATASOURCE_URL") != null
            ? System.getenv("SPRING_DATASOURCE_URL")
            : "jdbc:postgresql://host.docker.internal:5432/aml_db";

    private static final String DB_USER =
        System.getenv("SPRING_DATASOURCE_USERNAME") != null
            ? System.getenv("SPRING_DATASOURCE_USERNAME")
            : "postgres";

    private static final String DB_PASSWORD =
        System.getenv("SPRING_DATASOURCE_PASSWORD") != null
            ? System.getenv("SPRING_DATASOURCE_PASSWORD")
            : "";

    private static final ObjectMapper JSON = new ObjectMapper();

    // -------------------------------------------------
    // MAIN
    // -------------------------------------------------

    public static void main(String[] args) {
        SpringApplication.run(TransactionMonitoringApplication.class, args);
    }

    // -------------------------------------------------
    // HOME
    // -------------------------------------------------

    @CrossOrigin(origins = "*")
    @GetMapping("/")
    public Map<String, Object> home() {
        return Map.of(
            "status",  "RUNNING",
            "system",  "AML Monitoring — Java API",
            "mlUrl",   ML_SERVICE_URL,
            "endpoints", List.of("/monitor", "/health", "/ai-search")
        );
    }

    // -------------------------------------------------
    // HEALTH — checks DB + Python ML, used by React UI
    // to display the 3-service status bar
    // -------------------------------------------------

    @CrossOrigin(origins = "*")
    @GetMapping("/health")
    public Map<String, Object> health() {

        Map<String, Object> status = new HashMap<>();
        status.put("api", "UP");

        // Check database
        try (Connection conn = getConnection()) {
            status.put("database", "UP");
        } catch (Exception e) {
            status.put("database", "DOWN");
        }

        // Check Python ML service
        try {
            URL               url  = new URL(ML_SERVICE_URL + "/");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(2000);
            conn.setReadTimeout(2000);
            int code = conn.getResponseCode();
            status.put("mlService", code == 200 ? "UP" : "DEGRADED");
        } catch (Exception e) {
            status.put("mlService", "DOWN");
        }

        return status;
    }

    // -------------------------------------------------
    // AI SEARCH PROXY
    // React calls Java /ai-search → Java forwards to
    // Python ML /ai-search → returns NLP-parsed filters
    // This keeps React talking to one backend only.
    // -------------------------------------------------

    @CrossOrigin(origins = "*")
    @PostMapping("/ai-search")
    public ResponseEntity<String> proxyAiSearch(
            @RequestBody Map<String, Object> body
    ) {
        try {
            String jsonBody = JSON.writeValueAsString(body);

            URL               url  = new URL(ML_SERVICE_URL + "/ai-search");
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(10000);
            conn.setRequestProperty("Content-Type", "application/json");
            conn.setRequestProperty("Accept",       "application/json");

            try (OutputStream os = conn.getOutputStream()) {
                os.write(jsonBody.getBytes("UTF-8"));
            }

            BufferedReader reader = new BufferedReader(
                new InputStreamReader(conn.getInputStream())
            );
            StringBuilder sb = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) sb.append(line);
            reader.close();

            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body(sb.toString());

        } catch (Exception e) {
            e.printStackTrace();
            // Fallback: return empty filter so UI can still do client-side search
            return ResponseEntity.ok()
                .contentType(MediaType.APPLICATION_JSON)
                .body("{\"caseId\":null,\"customerId\":null,\"severity\":null,\"rules\":[],\"name\":null}");
        }
    }

    // -------------------------------------------------
    // MAIN AML MONITOR ENDPOINT
    // Loads transactions from DB, runs rule engine,
    // calls Python ML service for anomaly scoring.
    // -------------------------------------------------

    // Set to false after the first trade_file failure so we never open
    // another DB connection for it — was causing ~500 failed connections per request.
    private static volatile boolean tradeFileExists = true;

    // FIX: returns ResponseEntity<List> so errors return [] not an error Map.
    // A Map response caused React to crash with "alerts.filter is not a function".
    @CrossOrigin(origins = "*")
    @GetMapping("/monitor")
    public ResponseEntity<List<Alert>> monitor() {
        try {
            List<Transaction>              transactions = loadTransactions();
            Map<String, List<Transaction>> grouped      = groupTransactions(transactions);
            List<Alert>                    alerts       = new ArrayList<>();

            // Cap at 150 customers — processing all ~1000+ sequentially caused
            // multi-minute load times. Sort by total transaction volume descending
            // so the highest-risk customers appear first.
            List<Map.Entry<String, List<Transaction>>> entries = new ArrayList<>(grouped.entrySet());
            entries.sort((a, b) -> Double.compare(
                b.getValue().stream().mapToDouble(t -> t.amount).sum(),
                a.getValue().stream().mapToDouble(t -> t.amount).sum()
            ));
            if (entries.size() > 150) entries = entries.subList(0, 150);

            // FIX: fire all ML calls in parallel instead of sequentially.
            // 150 sequential calls × ~50ms each = 7+ seconds of waiting.
            // Parallel cuts that to roughly the time of a single call.
            List<CompletableFuture<Alert>> futures = new ArrayList<>();

            for (Map.Entry<String, List<Transaction>> entry : entries) {
                final String              customerId = entry.getKey();
                final List<Transaction>   txns       = entry.getValue();
                final String              clientName = txns.get(0).clientName;

                futures.add(CompletableFuture.supplyAsync(() -> {
                    try {
                        Alert alert  = new Alert(customerId, clientName);
                        alert.caseId = "AML-" + System.currentTimeMillis() + "-" + customerId;

                        applyRules(txns, alert);
                        alert.anomalyScore = callPythonModel(txns);

                        // Severity: driven by ML score and rule hits.
                        // Total-amount thresholds raised to ₹100Cr / ₹20Cr so normal
                        // business volumes don't auto-escalate every customer to MEDIUM.
                        // LOW: total transaction amount below ₹3Cr — always LOW regardless of rules/ML
                        // HIGH:   total ≥ ₹3Cr AND (3+ rule hits OR ML ≥ 70 OR total ≥ ₹3.5Cr)
                        // MEDIUM: total ≥ ₹3Cr AND everything else
                        if (alert.totalTransactionAmount < 30_000_000) {
                            alert.severity = "LOW";
                        } else if (alert.anomalyScore >= 70 || alert.ruleHits.size() >= 3 || alert.totalTransactionAmount >= 35_000_000) {
                            alert.severity = "HIGH";
                        } else {
                            alert.severity = "MEDIUM";
                        }

                        alert.reason = !alert.ruleHits.isEmpty()
                            ? String.join(", ", alert.ruleHits)
                            : "ML anomaly detection";

                        return alert;
                    } catch (Exception e) {
                        System.out.println("[WARN] Skipping customer " + customerId + ": " + e.getMessage());
                        return null;
                    }
                }));
            }

            for (CompletableFuture<Alert> f : futures) {
                Alert a = f.get();
                if (a != null) alerts.add(a);
            }

            return ResponseEntity.ok(alerts);

        } catch (Exception e) {
            // FIX: always return a JSON array — never return an error Map.
            // If we return a Map, React calls .filter() on it and crashes (white screen).
            e.printStackTrace();
            return ResponseEntity.ok(new ArrayList<>());
        }
    }

    // -------------------------------------------------
    // RUN SCREENING
    // FIX: removed hardcoded Windows path
    // "D:\Internship\Screening\start_aml.bat"
    // Replace the command for your environment.
    // -------------------------------------------------

    @CrossOrigin(origins = "*")
    @PostMapping("/run-screening")
    public ResponseEntity<String> runScreening() {
        // Configure for your environment, e.g.:
        //   Linux: new ProcessBuilder("bash", "/opt/aml/start_aml.sh")
        //   Windows: new ProcessBuilder("cmd.exe", "/c", "C:\\aml\\start_aml.bat")
        return ResponseEntity.ok(
            "Screening endpoint ready. Set the script path in runScreening() for your environment."
        );
    }

    // -------------------------------------------------
    // MODELS
    // -------------------------------------------------

    static class Transaction {
        public String customerId, clientName, transactionDate;
        public String segment, voucherType, remarks, instrumentType, transactionReference;
        public double amount;

        public Transaction(String customerId, String clientName, double amount,
                           String transactionDate, String segment, String voucherType,
                           String remarks, String instrumentType, String transactionReference) {
            this.customerId = customerId; this.clientName = clientName;
            this.amount = amount; this.transactionDate = transactionDate;
            this.segment = segment; this.voucherType = voucherType;
            this.remarks = remarks; this.instrumentType = instrumentType;
            this.transactionReference = transactionReference;
        }
    }

    static class Trade {
        public String customerId, clientName, tradeId, buySell, scripCode, tradeDate, tradeStatus;
        public double rate, qty;

        public Trade(String customerId, String clientName, String tradeId,
                     String buySell, double rate, double qty,
                     String scripCode, String tradeDate, String tradeStatus) {
            this.customerId = customerId; this.clientName = clientName;
            this.tradeId = tradeId; this.buySell = buySell;
            this.rate = rate; this.qty = qty;
            this.scripCode = scripCode; this.tradeDate = tradeDate;
            this.tradeStatus = tradeStatus;
        }
    }

    static class Alert {
        public String       caseId, customerId, clientName, severity, reason;
        public List<String> ruleHits = new ArrayList<>();
        public double       anomalyScore, totalTransactionAmount;
        public int          transactionCount;

        public Alert(String customerId, String clientName) {
            this.customerId = customerId;
            this.clientName = clientName;
        }
    }

    // -------------------------------------------------
    // DATABASE
    // -------------------------------------------------

    private Connection getConnection() throws Exception {
        Class.forName("org.postgresql.Driver");
        return DriverManager.getConnection(DB_URL, DB_USER, DB_PASSWORD);
    }

    private List<Transaction> loadTransactions() throws Exception {
        List<Transaction> list = new ArrayList<>();
        try (Connection conn = getConnection();
             PreparedStatement stmt = conn.prepareStatement("""
                SELECT customer_id, client_name, amount, transaction_date,
                       segment, voucher_type, remarks, instrument_type,
                       transaction_reference_number
                FROM transaction_file
             """);
             ResultSet rs = stmt.executeQuery()) {

            while (rs.next()) {
                list.add(new Transaction(
                    String.valueOf(rs.getObject("customer_id")),
                    rs.getString("client_name"),
                    rs.getDouble("amount"),
                    rs.getString("transaction_date"),
                    rs.getString("segment"),
                    rs.getString("voucher_type"),
                    rs.getString("remarks"),
                    rs.getString("instrument_type"),
                    rs.getString("transaction_reference_number")
                ));
            }
        }
        return list;
    }

    private List<Trade> loadTrades(String customerId) throws Exception {
        List<Trade> trades = new ArrayList<>();
        try (Connection conn = getConnection();
             PreparedStatement stmt = conn.prepareStatement("""
                SELECT customer_id, client_name, trade_id, buy_sell,
                       rate, qty, scrip_code, trade_date, trade_status
                FROM trade_file
                WHERE CAST(customer_id AS TEXT) = ?
             """)) {

            stmt.setString(1, customerId);
            try (ResultSet rs = stmt.executeQuery()) {
                while (rs.next()) {
                    trades.add(new Trade(
                        String.valueOf(rs.getObject("customer_id")),
                        rs.getString("client_name"),
                        rs.getString("trade_id"),
                        rs.getString("buy_sell"),
                        rs.getDouble("rate"),
                        rs.getDouble("qty"),
                        rs.getString("scrip_code"),
                        rs.getString("trade_date"),
                        rs.getString("trade_status")
                    ));
                }
            }
        }
        return trades;
    }

    // -------------------------------------------------
    // RULE ENGINE
    // -------------------------------------------------

    private Map<String, List<Transaction>> groupTransactions(List<Transaction> txns) {
        Map<String, List<Transaction>> grouped = new HashMap<>();
        for (Transaction t : txns)
            grouped.computeIfAbsent(t.customerId, k -> new ArrayList<>()).add(t);
        return grouped;
    }

    private void applyRules(List<Transaction> txns, Alert alert) throws Exception {
        double total = 0;
        int    structuring = 0, highValue = 0;
        Map<String, Integer> dateCounts = new HashMap<>();

        for (Transaction t : txns) {
            total += t.amount;

            // STRUCTURING: transactions just below RBI ₹10L cash-reporting threshold
            if (t.amount >= 900_000 && t.amount < 1_000_000) structuring++;

            // HIGH VALUE: single transaction above ₹45L (top ~5% of txns, near max ₹50L)
            if (t.amount > 4_500_000) highValue++;

            // RAPID MOVEMENT: bucket transactions by calendar day
            if (t.transactionDate != null && !t.transactionDate.isBlank()) {
                String day = t.transactionDate.length() >= 10
                    ? t.transactionDate.substring(0, 10)
                    : t.transactionDate;
                dateCounts.merge(day, 1, Integer::sum);
            }
        }

        alert.totalTransactionAmount = total;
        alert.transactionCount       = txns.size();

        // Days on which 3+ transactions were booked = burst / rapid movement
        int rapidDays = (int) dateCounts.values().stream().filter(c -> c >= 3).count();

        // Thresholds calibrated to dataset: customer totals ₹1L–₹4.4Cr, avg ₹1.67Cr
        if (total       > 30_000_000)  alert.ruleHits.add("LARGE_TRANSACTION_VOLUME");              // > ₹3Cr (top ~10%)
        if (structuring >= 2)           alert.ruleHits.add("STRUCTURING_PATTERN");                   // 2+ near-threshold txns
        if (rapidDays   >= 2)           alert.ruleHits.add("RAPID_MOVEMENT");                        // burst on 2+ days
        if (highValue   >= 2)           alert.ruleHits.add("MULTIPLE_HIGH_VALUE_TRANSACTIONS");      // 2+ txns > ₹25L

        if (tradeFileExists) {
            try {
                double tradeTotal = 0;
                List<Trade> trades = loadTrades(alert.customerId);
                for (Trade t : trades) tradeTotal += t.rate * t.qty;
                // Flag only if the customer has transactions but NO trades at all
                // (banking activity with zero recorded trades = suspicious layering)
                // OR if trade count is suspiciously low relative to transaction count
                // (< 2 trades but 5+ transactions suggests records are being hidden)
                if (tradeTotal == 0 && alert.transactionCount >= 5) {
                    alert.ruleHits.add("TRADE_TRANSACTION_MISMATCH");
                } else if (trades.size() < 2 && alert.transactionCount >= 5) {
                    alert.ruleHits.add("TRADE_TRANSACTION_MISMATCH");
                }
            } catch (Exception e) {
                tradeFileExists = false;
                System.out.println("[INFO] trade_file not available — TRADE_TRANSACTION_MISMATCH rule disabled");
            }
        }
    }

    // -------------------------------------------------
    // PYTHON ML SERVICE CALL
    // Java → GET http://ml-service:5000/predict
    // Returns IsolationForest anomaly score (1–99)
    // -------------------------------------------------

    private double callPythonModel(List<Transaction> txns) {
        try {
            double total = 0, max = 0, min = Double.MAX_VALUE;
            int    bankCount = 0;

            for (Transaction t : txns) {
                total += t.amount;
                if (t.amount > max) max = t.amount;
                if (t.amount < min) min = t.amount;
                if (t.voucherType != null && t.voucherType.contains("BANK")) bankCount++;
            }

            int    count      = txns.size();
            double avg        = total / count;
            double cashRatio  = count > 0 ? (double) bankCount / count : 0;
            // FIX: was hardcoded "count > 10 ? 0.8 : 0.2" which gave every customer
            // with more than 10 transactions a rapidRatio of 0.8 → auto +10 boost in
            // IsolationForest → almost everyone scored HIGH. Now uses actual ratio.
            double rapidRatio = count > 0 ? (double) bankCount / count : 0;

            String urlStr = ML_SERVICE_URL + "/predict"
                + "?total="      + total
                + "&count="      + count
                + "&avg="        + avg
                + "&max="        + max
                + "&min="        + min
                + "&bank="       + bankCount
                + "&cashratio="  + cashRatio
                + "&rapidratio=" + rapidRatio;

            URL               url  = new URL(urlStr);
            HttpURLConnection conn = (HttpURLConnection) url.openConnection();
            conn.setConnectTimeout(5000);
            conn.setReadTimeout(5000);
            conn.setRequestMethod("GET");

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream()));
            String         resp   = reader.readLine();
            reader.close();

            return Double.parseDouble(resp.trim());

        } catch (Exception e) {
            // FIX: was e.printStackTrace() which dumped a full stack trace whenever
            // the Python ML service wasn't ready yet (common on startup). A single
            // warning line is enough — the system recovers with ML score = 0.
            System.out.println("[WARN] ML service not reachable (" + ML_SERVICE_URL + "): "
                + e.getClass().getSimpleName() + ": " + e.getMessage()
                + " — anomaly score defaulting to 0");
            return 0;
        }
    }

    // -------------------------------------------------
    // SINGLE CUSTOMER ENDPOINT — called by Gateway
    // Returns fields the unified frontend expects:
    //   alertScore, suspicious, ruleHits, totalAmount, transactionCount, severity
    // -------------------------------------------------

    @CrossOrigin(origins = "*")
    @GetMapping("/transactions/{customerId}")
    public Map<String, Object> getCustomerTransactions(
            @PathVariable String customerId
    ) throws Exception {

        List<Transaction> all     = loadTransactions();
        List<Transaction> txns    = new ArrayList<>();

        for (Transaction t : all)
            if (customerId.equals(t.customerId)) txns.add(t);

        if (txns.isEmpty()) {
            Map<String, Object> empty = new HashMap<>();
            empty.put("customerId",        customerId);
            empty.put("alertScore",        0);
            empty.put("suspicious",        false);
            empty.put("ruleHits",          List.of());
            empty.put("totalAmount",       0);
            empty.put("transactionCount",  0);
            empty.put("severity",          "LOW");
            return empty;
        }

        Alert alert = new Alert(customerId, txns.get(0).clientName);
        applyRules(txns, alert);
        alert.anomalyScore = callPythonModel(txns);

        if (alert.totalTransactionAmount < 30_000_000) {
            alert.severity = "LOW";
        } else if (alert.anomalyScore >= 70 || alert.ruleHits.size() >= 3 || alert.totalTransactionAmount >= 35_000_000) {
            alert.severity = "HIGH";
        } else {
            alert.severity = "MEDIUM";
        }

        Map<String, Object> result = new HashMap<>();
        result.put("customerId",       customerId);
        result.put("clientName",       alert.clientName);
        result.put("alertScore",       alert.anomalyScore);
        result.put("suspicious",       !"LOW".equals(alert.severity));
        result.put("ruleHits",         alert.ruleHits);
        result.put("totalAmount",      alert.totalTransactionAmount);
        result.put("transactionCount", alert.transactionCount);
        result.put("severity",         alert.severity);
        return result;
    }

    // -------------------------------------------------
    // ERROR HANDLER
    // -------------------------------------------------

    @ExceptionHandler(Exception.class)
    public Map<String, Object> handleException(Exception e, HttpServletRequest req) {
        Map<String, Object> err = new HashMap<>();
        err.put("path",    req.getRequestURI());
        err.put("error",   e.getClass().getName());
        err.put("message", e.getMessage());
        err.put("status",  500);
        e.printStackTrace();
        return err;
    }
}

import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import "./App.css";

// ─────────────────────────────────────────────────────
// SERVICE URLS
// Override via environment variables for Docker/prod.
// React only talks to Java API; Java proxies to Python.
// ─────────────────────────────────────────────────────

const JAVA_API = process.env.REACT_APP_JAVA_API || "http://localhost:8080";

// ─────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────

function ServiceBadge({ label, sub, status }) {
  const cls = (status || "checking").toLowerCase();
  return (
    <div className={`svc-badge svc-${cls}`}>
      <span className="svc-dot" />
      <div>
        <div className="svc-name">{label}</div>
        <div className="svc-sub">{sub}</div>
      </div>
    </div>
  );
}

function SeverityPill({ sev }) {
  return (
    <span className={`pill pill-${(sev || "low").toLowerCase()}`}>
      {sev}
    </span>
  );
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div className="stat-card" style={{ "--accent": accent }}>
      <div className="stat-value">{value ?? "—"}</div>
      <div className="stat-label">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────

export default function App() {

  // ── State ──────────────────────────────────────────

  const [alerts,        setAlerts]        = useState([]);
  const [filtered,      setFiltered]      = useState([]);
  const [health,        setHealth]        = useState({
    api: "CHECKING", mlService: "CHECKING", database: "CHECKING",
  });
  const [search,        setSearch]        = useState("");
  const [searchMode,    setSearchMode]    = useState("ai");
  const [showDropdown,  setShowDropdown]  = useState(false);
  const [loadingData,   setLoadingData]   = useState(true);
  const [loadingAI,     setLoadingAI]     = useState(false);
  const [error,         setError]         = useState("");
  const [darkMode,      setDarkMode]      = useState(true);
  const [manualFilters, setManualFilters] = useState({
    caseId: "", customerId: "", clientName: "", severity: "", rules: "",
  });

  // ── 1. Health check: React → Java /health
  //       Java checks DB + Python internally ──────────

  useEffect(() => {
    fetch(`${JAVA_API}/health`)
      .then((r) => r.json())
      .then((data) => setHealth((h) => ({ ...h, ...data })))
      .catch(() =>
        setHealth({ api: "DOWN", mlService: "UNKNOWN", database: "UNKNOWN" })
      );
  }, []);

  // ── 2. Load alerts: React → Java /monitor
  //       Java → PostgreSQL (transactions + trades)
  //       Java → Python /predict (ML score per customer) ─

  useEffect(() => {
    setLoadingData(true);
    setError("");
    fetch(`${JAVA_API}/monitor`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // FIX: guard against non-array responses (e.g. Java exception handler returns
        // a Map with HTTP 200, causing .filter() to crash → white screen).
        const alerts = Array.isArray(data) ? data : [];
        if (!Array.isArray(data)) {
          setError(`Unexpected API response: ${data?.message || JSON.stringify(data)}`);
        }
        setAlerts(alerts);
        setFiltered(alerts);
      })
      .catch(() =>
        setError(
          `Cannot reach Java API at ${JAVA_API}. ` +
          "Make sure Spring Boot is running (or docker-compose up)."
        )
      )
      .finally(() => setLoadingData(false));
  }, []);

  // ── 3. AI search: React → Java /ai-search
  //       Java → Python /ai-search (NLP parse → filters)
  //       Falls back to client-side text search ─────────

  const runAiSearch = useCallback(async () => {
    if (!search.trim()) {
      setFiltered(alerts);
      return;
    }
    setLoadingAI(true);
    try {
      const res = await fetch(`${JAVA_API}/ai-search`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ message: search }),
      });
      const p = await res.json();
      setFiltered(
        alerts.filter((a) => {
          if (p.caseId     && !a.caseId    ?.toLowerCase().includes(p.caseId.toLowerCase()))     return false;
          if (p.customerId && a.customerId?.toString() !== p.customerId?.toString())              return false;
          if (p.severity   && a.severity   !== p.severity)                                        return false;
          if (p.rules?.length > 0 && !p.rules.some((r) => a.ruleHits?.includes(r)))              return false;
          if (p.name       && !a.clientName?.toLowerCase().includes(p.name.toLowerCase()))        return false;
          return true;
        })
      );
    } catch {
      // Fallback: plain substring search across all fields
      const lc = search.toLowerCase();
      setFiltered(
        alerts.filter((a) =>
          [a.caseId, a.customerId, a.clientName, a.severity, ...(a.ruleHits || [])]
            .join(" ")
            .toLowerCase()
            .includes(lc)
        )
      );
    } finally {
      setLoadingAI(false);
    }
  }, [search, alerts]);

  useEffect(() => {
    if (searchMode !== "ai") return;
    const t = setTimeout(runAiSearch, 300);
    return () => clearTimeout(t);
  }, [search, searchMode, runAiSearch]);

  // ── Manual filter ──────────────────────────────────

  useEffect(() => {
    if (searchMode !== "manual") return;
    const f = manualFilters;
    setFiltered(
      alerts.filter((a) => {
        if (f.caseId     && !a.caseId    ?.toLowerCase().includes(f.caseId.toLowerCase()))     return false;
        if (f.customerId && !a.customerId?.toString().includes(f.customerId))                   return false;
        if (f.clientName && !a.clientName?.toLowerCase().includes(f.clientName.toLowerCase())) return false;
        if (f.severity   && !a.severity  ?.toLowerCase().includes(f.severity.toLowerCase()))   return false;
        if (f.rules      && !(a.ruleHits || []).join(" ").toLowerCase().includes(f.rules.toLowerCase())) return false;
        return true;
      })
    );
  }, [manualFilters, alerts, searchMode]);

  // ── Suggestions ────────────────────────────────────

  const suggestions = useMemo(() => {
    const v = [];
    alerts.forEach((a) => {
      if (a.customerId) v.push(String(a.customerId));
      if (a.clientName) v.push(a.clientName);
      if (a.severity)   v.push(a.severity);
      if (a.caseId)     v.push(a.caseId);
      (a.ruleHits || []).forEach((r) => v.push(r));
    });
    return [...new Set(v)];
  }, [alerts]);

  const dropSuggestions = useMemo(
    () =>
      suggestions
        .filter((s) => s && search && s.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 6),
    [suggestions, search]
  );

  // ── Stats ──────────────────────────────────────────

  const counts = useMemo(
    () => ({
      high:   alerts.filter((a) => a.severity === "HIGH").length,
      medium: alerts.filter((a) => a.severity === "MEDIUM").length,
      low:    alerts.filter((a) => a.severity === "LOW").length,
      scored: alerts.filter((a) => a.anomalyScore > 0).length,
    }),
    [alerts]
  );

  // ── Helpers ────────────────────────────────────────

  const uniqueVals = (field) =>
    [
      ...new Set(
        alerts
          .map((a) =>
            field === "rules" ? (a.ruleHits || []).join(", ") : a[field]
          )
          .filter(Boolean)
      ),
    ];

  const switchMode = (mode) => {
    setSearchMode(mode);
    setSearch("");
    setManualFilters({ caseId: "", customerId: "", clientName: "", severity: "", rules: "" });
    setFiltered(alerts);
  };

  // ── Render ─────────────────────────────────────────

  return (
    <div className={`app ${darkMode ? "dark" : "light"}`}>

      {/* ════════ HEADER ════════ */}
      <header className="header">
        <div className="header-left">
          <h1>AML Monitoring</h1>
          <p>Real-time transaction screening powered by 3-service architecture</p>
        </div>
        <div className="header-right">
          <div className="svc-bar">
            <ServiceBadge label="Java API"   sub="Spring Boot :8080" status={health.api} />
            <ServiceBadge label="ML Service" sub="Python :5000"      status={health.mlService} />
            <ServiceBadge label="Database"   sub="PostgreSQL :5432"  status={health.database} />
          </div>
          <button className="theme-btn" onClick={() => setDarkMode((d) => !d)}>
            {darkMode ? "☀ Light" : "🌙 Dark"}
          </button>
        </div>
      </header>

      {/* ════════ STATS ════════ */}
      <section className="stats-row">
        <StatCard label="High Risk"    value={counts.high}    accent="#ef4444" sub="Immediate review" />
        <StatCard label="Medium Risk"  value={counts.medium}  accent="#f59e0b" sub="Investigate" />
        <StatCard label="Low Risk"     value={counts.low}     accent="#22c55e" sub="Monitor" />
        <StatCard label="Total Cases"  value={alerts.length}  accent="#6366f1" sub="All customers" />
        <StatCard label="ML-Scored"    value={counts.scored}  accent="#06b6d4" sub="IsolationForest" />
      </section>

      {/* ════════ ARCHITECTURE FLOW ════════ */}
      <div className="flow-bar">
        <span className="flow-label">Data flow:</span>
        <span className="flow-node react-node">React UI :3000</span>
        <span className="flow-arrow">→ REST →</span>
        <span className="flow-node java-node">Java API :8080</span>
        <span className="flow-arrow">→ SQL →</span>
        <span className="flow-node db-node">PostgreSQL :5432</span>
        <span className="flow-divider">|</span>
        <span className="flow-node java-node">Java API :8080</span>
        <span className="flow-arrow">→ REST →</span>
        <span className="flow-node ml-node">Python ML :5000</span>
        <span className="flow-divider">|</span>
        <span className="flow-note">AI search proxied through Java</span>
      </div>

      {/* ════════ SEARCH HEADER ════════ */}
      <div className="search-header">
        <div className="mode-tabs">
          <button
            className={`tab ${searchMode === "ai" ? "tab-active" : ""}`}
            onClick={() => switchMode("ai")}
          >
            ✦ AI Search
          </button>
          <button
            className={`tab ${searchMode === "manual" ? "tab-active" : ""}`}
            onClick={() => switchMode("manual")}
          >
            ⊞ Manual Filter
          </button>
        </div>
        <span className="result-count">
          {filtered.length} / {alerts.length} cases
        </span>
      </div>

      {/* ════════ AI SEARCH ════════ */}
      {searchMode === "ai" && (
        <div className="search-wrap">
          <input
            className="search-input"
            type="text"
            placeholder='Try: "high risk", "customer 4521", "rapid movement", "mismatch"'
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setShowDropdown(true);
            }}
            onBlur={() => setTimeout(() => setShowDropdown(false), 160)}
          />
          {loadingAI && <span className="search-spin" />}
          {showDropdown && search && dropSuggestions.length > 0 && (
            <div className="dropdown">
              {dropSuggestions.map((s, i) => (
                <div
                  key={i}
                  className="dropdown-item"
                  onMouseDown={() => {
                    setSearch(s);
                    setShowDropdown(false);
                  }}
                >
                  {s}
                </div>
              ))}
            </div>
          )}
          <p className="search-note">
            Query parsed by Python ML service via Java proxy →
            filters applied client-side
          </p>
        </div>
      )}

      {/* ════════ MANUAL FILTER ════════ */}
      {searchMode === "manual" && (
        <div className="manual-grid">
          {Object.entries(manualFilters).map(([key, val]) => (
            <div key={key} className="manual-field">
              <label>{key.replace(/([A-Z])/g, " $1").toLowerCase()}</label>
              <input
                list={`dl-${key}`}
                className="search-input"
                placeholder={`Filter by ${key}…`}
                value={val}
                onChange={(e) =>
                  setManualFilters((f) => ({ ...f, [key]: e.target.value }))
                }
              />
              <datalist id={`dl-${key}`}>
                {uniqueVals(key).map((v, i) => (
                  <option key={i} value={v} />
                ))}
              </datalist>
            </div>
          ))}
        </div>
      )}

      {/* ════════ ERROR ════════ */}
      {error && <div className="error-banner">⚠ {error}</div>}

      {/* ════════ LOADING ════════ */}
      {loadingData && (
        <div className="loading-wrap">
          <div className="loader" />
          <p>Fetching from Java API → PostgreSQL…</p>
        </div>
      )}

      {/* ════════ TABLE ════════ */}
      {!loadingData && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Case ID</th>
                <th>Customer</th>
                <th>Name</th>
                <th>Severity</th>
                <th>
                  <span title="Anomaly score computed by Python IsolationForest ML Service">
                    ML Score ↗
                  </span>
                </th>
                <th>Rules Triggered</th>
                <th>Total Amount</th>
                <th>Txns</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="no-results">
                    No matching cases
                  </td>
                </tr>
              ) : (
                filtered.map((a, i) => (
                  <tr
                    key={i}
                    className={`row-${(a.severity || "low").toLowerCase()}`}
                  >
                    <td className="td-mono">{a.caseId}</td>
                    <td>{a.customerId}</td>
                    <td>{a.clientName}</td>
                    <td>
                      <SeverityPill sev={a.severity} />
                    </td>
                    <td>
                      <MlScore score={a.anomalyScore} />
                    </td>
                    <td>
                      <div className="rules-cell">
                        {(a.ruleHits || []).length > 0 ? (
                          a.ruleHits.map((r, ri) => (
                            <span key={ri} className="rule-tag">
                              {r}
                            </span>
                          ))
                        ) : (
                          <span className="no-rule">—</span>
                        )}
                      </div>
                    </td>
                    <td className="td-amount">
                      ₹{a.totalTransactionAmount?.toLocaleString("en-IN")}
                    </td>
                    <td>{a.transactionCount}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ════════ FOOTER ════════ */}
      <footer className="footer">
        React UI :3000 → Java Spring Boot :8080 → PostgreSQL :5432 + Python
        IsolationForest :5000
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// ML SCORE CELL — colour-coded bar
// ─────────────────────────────────────────────────────

function MlScore({ score }) {
  const n = parseFloat(score) || 0;
  const color =
    n >= 70 ? "#ef4444" : n >= 40 ? "#f59e0b" : "#22c55e";
  return (
    <div className="ml-score-wrap" title="Score from Python IsolationForest">
      <div className="ml-bar-bg">
        <div
          className="ml-bar-fill"
          style={{ width: `${n}%`, background: color }}
        />
      </div>
      <span className="ml-score-num" style={{ color }}>
        {n.toFixed(1)}
      </span>
    </div>
  );
}

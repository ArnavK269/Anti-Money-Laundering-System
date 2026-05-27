from flask import Flask, request
from flask_cors import CORS
from sklearn.ensemble import IsolationForest
import numpy as np
import re
import json
import requests

app = Flask(__name__)
CORS(app)  # FIX: enable CORS so React browser can call this service

# -------------------------------------------------
# TRAINING DATA
# -------------------------------------------------

# Training data scaled to realistic INR banking volumes.
# Columns: [total, count, avg, max, min, bankCount, cashRatio, rapidRatio]
# Amounts in rupees — low-risk totals ₹5L–₹5Cr, high-risk ₹50Cr+
# Training data calibrated to real dataset:
# - Transaction amounts: ₹1.5K – ₹50L per txn
# - Customer totals: ₹10K – ₹4.4Cr
# - Avg transactions per customer: ~6-7
# Columns: [total, count, avg, max, min, bankCount, cashRatio, rapidRatio]
X = np.array([
    # VERY LOW RISK — minimal activity
    [10_000,     1,   10_000,   10_000,   1_500, 0, 0.10, 0.10],
    [50_000,     1,   50_000,   50_000,   5_000, 0, 0.10, 0.10],
    [150_000,    2,   75_000,  100_000,  10_000, 0, 0.20, 0.10],
    [300_000,    2,  150_000,  200_000,  10_000, 1, 0.20, 0.10],
    [600_000,    3,  200_000,  350_000,  10_000, 1, 0.30, 0.20],
    # LOW RISK — normal customer volumes (bulk of dataset)
    [1_000_000,  4,  250_000,  500_000,  10_000, 1, 0.30, 0.20],
    [2_000_000,  5,  400_000, 1_000_000, 10_000, 2, 0.40, 0.20],
    [3_500_000,  6,  583_333, 1_500_000, 10_000, 2, 0.40, 0.25],
    [6_000_000,  7,  857_142, 2_000_000, 10_000, 3, 0.50, 0.25],
    [9_000_000,  8, 1_125_000, 2_500_000, 10_000, 3, 0.50, 0.30],
    # MEDIUM RISK — elevated volumes / some suspicious patterns
    [12_000_000,  8, 1_500_000, 3_000_000, 10_000, 4, 0.55, 0.35],
    [16_000_000,  9, 1_777_777, 3_500_000, 10_000, 4, 0.60, 0.40],
    [20_000_000, 10, 2_000_000, 4_000_000, 10_000, 5, 0.65, 0.45],
    [25_000_000, 11, 2_272_727, 4_500_000, 10_000, 6, 0.70, 0.50],
    # HIGH RISK — near top of dataset range with suspicious patterns
    [30_000_000, 11, 2_727_272, 4_800_000, 10_000, 7, 0.75, 0.55],
    [35_000_000, 12, 2_916_666, 4_999_944, 10_000, 8, 0.80, 0.65],
    [40_000_000, 13, 3_076_923, 4_999_944, 10_000, 9, 0.85, 0.70],
    [44_000_000, 14, 3_142_857, 4_999_944, 10_000, 10, 0.90, 0.80],
])

# -------------------------------------------------
# MODEL
# -------------------------------------------------

model = IsolationForest(
    contamination=0.08,
    n_estimators=300,
    max_samples='auto',
    random_state=42
)
model.fit(X)

# -------------------------------------------------
# HOME
# -------------------------------------------------

@app.route("/")
def home():
    return {
        "status": "RUNNING",
        "service": "AML ML Service"
    }

# -------------------------------------------------
# PREDICT ENDPOINT
# -------------------------------------------------

@app.route("/predict")
def predict():
    try:
        total      = float(request.args.get("total", 0))
        count      = int(request.args.get("count", 1))
        avg        = float(request.args.get("avg", 0))
        max_amt    = float(request.args.get("max", 0))
        min_amt    = float(request.args.get("min", 0))
        bank       = int(request.args.get("bank", 0))
        cashratio  = float(request.args.get("cashratio", 0))
        rapidratio = float(request.args.get("rapidratio", 0))

        sample = np.array([[total, count, avg, max_amt, min_amt, bank, cashratio, rapidratio]])

        score      = model.decision_function(sample)[0]
        normalized = (0.4 - score) * 120

        # Boosts calibrated to real dataset: totals ₹10K–₹4.4Cr, avg txn ₹2.5L–₹25L
        if total      > 30_000_000:  normalized += 8   # > ₹3Cr (top ~10%)
        if total      > 38_000_000:  normalized += 8   # > ₹3.8Cr (top ~2%)
        if count      > 12:           normalized += 5   # more than 12 txns
        if avg        > 3_000_000:   normalized += 6   # avg txn > ₹30L
        if max_amt    > 4_000_000:   normalized += 8   # single txn > ₹40L
        if rapidratio > 0.7:          normalized += 6
        if cashratio  > 0.75:         normalized += 6

        # Reduce score for clearly low-risk profiles
        if total < 1_000_000:  normalized -= 20  # < ₹10L total
        if count < 3:           normalized -= 10

        normalized = max(1, min(99, normalized))

        return str(round(normalized, 2))

    except Exception as e:
        print(e)
        return "0"

# -------------------------------------------------
# AI SEARCH — Ollama primary, regex fallback
# FIX: was two duplicate functions; merged into one
# FIX: regex escape sequences corrected (\d+ not \\d+)
# -------------------------------------------------

@app.route("/ai-search", methods=["POST"])
def ai_search():
    try:
        data  = request.get_json()
        query = data.get("message", "")

        # --- Try Ollama first ---
        try:
            prompt = f"""
You are an AML search parser.
Extract search filters from the user query.
Return ONLY JSON with no extra text.

Possible fields: caseId, customerId, severity, rules, name
Severity must be: HIGH, MEDIUM, or LOW
Rules must be an array.

Example:
{{
  "caseId": null,
  "customerId": "1462",
  "severity": "HIGH",
  "rules": [],
  "name": null
}}

User query:
{query}
"""
            response = requests.post(
                "http://host.docker.internal:11434/api/generate",
                json={"model": "llama3", "prompt": prompt, "stream": False},
                timeout=5
            )
            text       = response.json()["response"]
            start      = text.find("{")
            end        = text.rfind("}") + 1
            json_text  = text[start:end]
            parsed     = json.loads(json_text)
            return parsed

        except Exception:
            # --- Regex fallback (FIX: corrected backslash escaping) ---
            lower = query.lower()

            result = {
                "caseId":     None,
                "customerId": None,
                "severity":   None,
                "rules":      [],
                "name":       None
            }

            # FIX: was r'aml[- ]?(\\d+[- ]?\\d+)' — extra backslash caused no matches
            case_match = re.search(r'aml[- ]?(\d+[- ]?\d+)', lower)
            if case_match:
                value = case_match.group(1).replace(' ', '-')
                result["caseId"] = f"AML-{value}"

            # FIX: was r'\b\d{4}\b' — extra backslash caused no matches
            customer_match = re.search(r'\b\d{4}\b', lower)
            if customer_match:
                result["customerId"] = customer_match.group(0)

            if "high" in lower:
                result["severity"] = "HIGH"
            elif "medium" in lower:
                result["severity"] = "MEDIUM"
            elif "low" in lower:
                result["severity"] = "LOW"

            rules_map = {
                "rapid":      "RAPID_MOVEMENT",
                "movement":   "RAPID_MOVEMENT",
                "mismatch":   "TRADE_TRANSACTION_MISMATCH",
                "structuring":"STRUCTURING_PATTERN",
                "high value": "MULTIPLE_HIGH_VALUE_TRANSACTIONS"
            }
            for key, value in rules_map.items():
                if key in lower:
                    result["rules"].append(value)

            # FIX: was r'name\\s+(\\w+)' — extra backslash caused no matches
            name_match = re.search(r'name\s+(\w+)', lower)
            if name_match:
                result["name"] = name_match.group(1)

            return result

    except Exception as e:
        print(e)
        return {
            "caseId": None, "customerId": None,
            "severity": None, "rules": [], "name": None
        }, 500

# -------------------------------------------------
# RUN
# -------------------------------------------------

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

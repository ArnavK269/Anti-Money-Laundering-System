"""
screening_api.py — REST API wrapper for the AML Screening service.

Exposes watchlist screening over HTTP so the Gateway can call it.
The Streamlit UI (main.py) remains fully functional and separate.

Endpoints:
  GET  /                              — health / info
  GET  /health                        — DB connectivity check
  GET  /screen/by-customer/<id>       — screen one customer (by customer_id from customers)
  GET  /screen/bulk                   — screen all customers in customers
"""

from flask import Flask, jsonify
from flask_cors import CORS
import psycopg
from psycopg.rows import dict_row
from rapidfuzz import fuzz
import os, re

app = Flask(__name__)
CORS(app)

# ─── DB config ─────────────────────────────────────────────────────────────
DB_HOST     = os.getenv("DB_HOST",     "host.docker.internal")
DB_NAME     = os.getenv("DB_NAME",     "aml_db")
DB_USER     = os.getenv("DB_USER",     "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_PORT     = os.getenv("DB_PORT",     "5432")

def get_conn():
    return psycopg.connect(
        host=DB_HOST, dbname=DB_NAME, user=DB_USER,
        password=DB_PASSWORD, port=DB_PORT,
        row_factory=dict_row
    )

# ─── Watchlist cache ────────────────────────────────────────────────────────
_watchlist = None

def get_watchlist():
    global _watchlist
    if _watchlist is not None:
        return _watchlist
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT * FROM watchlist")
                rows = cur.fetchall()
        _watchlist = [dict(r) for r in rows]
    except Exception as e:
        print(f"Watchlist load failed: {e}")
        _watchlist = []
    return _watchlist

# ─── Helpers ───────────────────────────────────────────────────────────────
UNIQUE_FIELDS = ["pan", "aadhaar", "passport", "voter_id", "driving_license"]

def norm(v):
    if v is None:
        return ""
    return str(v).strip().lower()

def fuzzy_score(a, b):
    a, b = norm(a), norm(b)
    if not a or not b:
        return 0
    return fuzz.token_sort_ratio(a, b)

def screen_customer(cust: dict) -> dict:
    """Run one customer dict against the watchlist. Returns screening result."""
    watchlist = get_watchlist()

    best_score   = 0
    matched_entry = None
    match_method  = "No Match"

    # Strong match on unique IDs
    for field in UNIQUE_FIELDS:
        val = norm(cust.get(field))
        if not val:
            continue
        for entry in watchlist:
            if norm(entry.get(field)) == val:
                best_score    = 100
                matched_entry = entry
                match_method  = f"Strong Match ({field})"
                break
        if matched_entry:
            break

    # Fuzzy match on name + email
    if not matched_entry:
        has_email = bool(norm(cust.get("email")))
        for entry in watchlist:
            ns = fuzzy_score(cust.get("name"), entry.get("name"))
            if has_email:
                es    = fuzzy_score(cust.get("email"), entry.get("email"))
                score = 0.7 * ns + 0.3 * es
            else:
                # No email available — use name score with full weight
                score = float(ns)
            if score > best_score:
                best_score    = score
                matched_entry = entry
        if best_score >= 85:
            match_method = f"Fuzzy Match ({best_score:.1f}%)"
        else:
            matched_entry = None
            best_score    = 0

    is_match = matched_entry is not None
    return {
        "match":      is_match,
        "confidence": round(best_score, 1),
        "matchType":  match_method,
        "list":       matched_entry.get("source", "Watchlist") if is_match else "Clear",
        "reason":     matched_entry.get("reason", "")         if is_match else "",
        "matchedName":matched_entry.get("name", "")          if is_match else "",
        "riskLevel":  "HIGH" if best_score >= 95 else ("MEDIUM" if best_score >= 85 else "LOW"),
    }

# ─── Routes ────────────────────────────────────────────────────────────────

@app.get("/")
def home():
    return jsonify({"status": "RUNNING", "service": "AML Screening API", "port": 8082})

@app.get("/health")
def health():
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
        return jsonify({"status": "UP", "database": "UP"})
    except Exception as e:
        return jsonify({"status": "UP", "database": "DOWN", "error": str(e)})

@app.get("/screen/by-customer/<int:customer_id>")
def screen_by_customer(customer_id: int):
    """
    Looks up customer from customers (shared with Risk Rating service),
    then screens them against the watchlist.
    """
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT customer_id, name, email, pan, aadhaar, passport
                       FROM customers WHERE customer_id = %s""",
                    (customer_id,)
                )
                row = cur.fetchone()

        if not row:
            return jsonify({"error": "Customer not found", "customerId": customer_id}), 404

        cust = dict(row)
        result = screen_customer({
            "name":     cust.get("name",     ""),
            "email":    cust.get("email",    ""),
            "pan":      cust.get("pan",      ""),
            "aadhaar":  cust.get("aadhaar",  ""),
            "passport": cust.get("passport", ""),
        })
        result["customerId"] = customer_id
        result["name"]       = cust.get("name", "")
        return jsonify(result)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.get("/screen/bulk")
def screen_bulk():
    """Screen all customers from customers against the watchlist."""
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT customer_id, name, email, pan, aadhaar, passport FROM customers"
                )
                customers = [dict(r) for r in cur.fetchall()]

        results = []
        for cust in customers:
            r = screen_customer({
                "name":     cust.get("name",     ""),
                "email":    cust.get("email",    ""),
                "pan":      cust.get("pan",      ""),
                "aadhaar":  cust.get("aadhaar",  ""),
                "passport": cust.get("passport", ""),
            })
            r["customerId"] = cust["customer_id"]
            r["name"]       = cust.get("name", "")
            results.append(r)

        return jsonify(results)

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ─── Run ───────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8082, debug=False)

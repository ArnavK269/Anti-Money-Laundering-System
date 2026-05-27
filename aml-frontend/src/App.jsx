import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./styles.css";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ──────────────────────────────────────────────────────────────
// SERVICE URLs — set via env vars for Docker; fall back to localhost
// ──────────────────────────────────────────────────────────────
const GATEWAY_URL     = import.meta.env.VITE_GATEWAY_URL     || "http://localhost:8080";
const RISK_URL        = import.meta.env.VITE_RISK_URL        || "http://localhost:8081";
const SCREENING_URL   = import.meta.env.VITE_SCREENING_URL   || "http://localhost:8082";
const TRANSACTION_URL = import.meta.env.VITE_TRANSACTION_URL || "http://localhost:8083";

// ──────────────────────────────────────────────────────────────
// SMALL COMPONENTS
// ──────────────────────────────────────────────────────────────

function Dot({ status }) {
  const cls = { UP: "dot-up", DOWN: "dot-down", CHECKING: "dot-wait" }[status] || "dot-wait";
  return <span className={`dot ${cls}`} />;
}

function Svc({ label, sub, status }) {
  return (
    <div className="svc">
      <Dot status={status} />
      <div><div className="svc-lbl">{label}</div><div className="svc-sub">{sub}</div></div>
    </div>
  );
}

function Pill({ v, map }) {
  const cls = map?.[v] || "pill-neutral";
  return <span className={`pill ${cls}`}>{v}</span>;
}

function StatCard({ label, value, accent, sub }) {
  return (
    <div className="stat-card" style={{ "--ac": accent }}>
      <div className="stat-val">{value ?? "—"}</div>
      <div className="stat-lbl">{label}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function Loader({ text }) {
  return (
    <div className="loader-wrap">
      <div className="spinner" />
      <span>{text}</span>
    </div>
  );
}

// ── Custom chart tooltip ─────────────────────────────────────
function ChartTooltip({ active, payload, label, valueFmt, labelFmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && label !== null && (
        <div className="ct-label">{labelFmt ? labelFmt(label) : label}</div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="ct-row">
          <span className="ct-dot" style={{ background: p.fill || p.color || "#6366f1" }} />
          <span className="ct-name">{p.name}</span>
          <span className="ct-val">{valueFmt ? valueFmt(p.value, p) : p.value}</span>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TAB 1 — PROFILE (unified via gateway)
// ──────────────────────────────────────────────────────────────

function ProfileTab() {
  const [id,      setId]      = useState("1");
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState("");

  const run = async (e) => {
    e?.preventDefault();
    if (!id.trim()) return;
    setLoading(true); setError(""); setProfile(null);
    try {
      const r = await fetch(`${GATEWAY_URL}/aml/${id.trim()}`);
      const d = await r.json();
      if (d.error) throw new Error(d.message);
      setProfile(d);
    } catch (err) {
      setError(err.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const risk = profile?.risk         || {};
  const sc   = profile?.screening    || {};
  const tx   = profile?.transactions || {};

  const riskTone = (s) => s >= 80 ? "danger" : s >= 50 ? "warning" : "ok";

  return (
    <div className="tab-body">
      <div className="section-hdr">
        <h2>Unified Customer AML Profile</h2>
        <p>Enter a customer ID to pull Risk Rating, Watchlist Screening, and Transaction Monitoring from a single gateway call.</p>
      </div>

      <form className="id-form" onSubmit={run}>
        <input value={id} onChange={e => setId(e.target.value)} placeholder="Customer ID" />
        <button type="submit" disabled={loading}>{loading ? "Checking…" : "Run Full AML Check"}</button>
      </form>

      {error   && <div className="err-bar">{error}</div>}
      {loading && <Loader text={`Calling Gateway → Risk :8081 + Screening :8082 + Transactions :8083…`} />}

      {profile && !loading && (
        <>
          {/* Customer name banner */}
          <div className="profile-name-hdr">
            <span className="profile-name-label">Customer</span>
            <span className="profile-name-val">
              {risk.name || tx.clientName || `Customer #${id}`}
            </span>
            <span className="profile-name-id">ID {id}</span>
          </div>

          <div className="profile-grid">
            {/* Risk Rating */}
            <div className="profile-card">
              <div className="pc-header">
                <span className="pc-title">Risk Rating</span>
                <span className={`pc-badge ${riskTone(risk.riskScore)}`}>{risk.riskLevel || "N/A"}</span>
              </div>
              <div className="pc-score">{risk.riskScore ?? "—"}</div>
              <div className="pc-detail">
                <div><span>Base Risk</span><strong>{risk.baseRisk ?? "—"}</strong></div>
                <div><span>ML Risk</span><strong>{risk.mlRisk ?? "—"}</strong></div>
                <div><span>PEP</span><strong>{String(risk.isPEP)}</strong></div>
                <div><span>Adverse Media</span><strong>{String(risk.hasAdverseMedia)}</strong></div>
                <div><span>High-Risk Country</span><strong>{String(risk.highRiskCountry)}</strong></div>
                <div><span>High-Risk Business</span><strong>{String(risk.highRiskBusiness)}</strong></div>
              </div>
              <p className="pc-src">Source: .NET Risk Service :8081 → Python ML :8000</p>
            </div>

            {/* Screening */}
            <div className="profile-card">
              <div className="pc-header">
                <span className="pc-title">Screening</span>
                <span className={`pc-badge ${sc.match ? "danger" : "ok"}`}>
                  {profile ? (sc.match ? "MATCH" : "CLEAR") : "Waiting"}
                </span>
              </div>
              <div className="pc-score" style={{ fontSize: 36 }}>{sc.matchType || (sc.match ? "FLAGGED" : "Clear")}</div>
              <div className="pc-detail">
                <div><span>Confidence</span><strong>{sc.confidence != null ? `${sc.confidence}%` : "—"}</strong></div>
                <div><span>List</span><strong>{sc.list || "—"}</strong></div>
                <div><span>Matched Name</span><strong>{sc.matchedName || "—"}</strong></div>
                <div><span>Reason</span><strong>{sc.reason || "—"}</strong></div>
              </div>
              <p className="pc-src">Source: Python Screening API :8082 → Watchlist DB</p>
            </div>

            {/* Transactions */}
            <div className="profile-card">
              <div className="pc-header">
                <span className="pc-title">Transactions</span>
                <span className={`pc-badge ${tx.suspicious ? "danger" : "ok"}`}>
                  {profile ? (tx.suspicious ? "SUSPICIOUS" : "NORMAL") : "Waiting"}
                </span>
              </div>
              <div className="pc-score">{tx.alertScore?.toFixed?.(1) ?? "—"}</div>
              <div className="pc-detail">
                <div><span>Severity</span><strong>{tx.severity || "—"}</strong></div>
                <div><span>Transactions</span><strong>{tx.transactionCount ?? "—"}</strong></div>
                <div><span>Total Amount</span><strong>₹{tx.totalAmount?.toLocaleString?.("en-IN") ?? "—"}</strong></div>
                <div><span>Rules Hit</span><strong>{(tx.ruleHits || []).join(", ") || "None"}</strong></div>
              </div>
              <p className="pc-src">Source: Java Transaction Service :8083 → Python ML :5000</p>
            </div>
          </div>

          {/* <details className="raw-json">
            <summary>Gateway raw JSON response</summary>
            <pre>{JSON.stringify(profile, null, 2)}</pre>
          </details> */}
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TAB 2 — TRANSACTION MONITORING
// ──────────────────────────────────────────────────────────────

function TransactionsTab() {
  const [alerts,       setAlerts]       = useState([]);
  const [filtered,     setFiltered]     = useState([]);
  const [loadingData,  setLoadingData]  = useState(true);
  const [loadingAI,    setLoadingAI]    = useState(false);
  const [search,       setSearch]       = useState("");
  const [searchMode,   setSearchMode]   = useState("ai");
  const [dropdown,     setDropdown]     = useState(false);
  const [error,        setError]        = useState("");
  const [manualF,      setManualF]      = useState({
    caseId: "", customerId: "", clientName: "", severity: "", rules: ""
  });

  useEffect(() => {
    fetch(`${TRANSACTION_URL}/monitor`)
      .then(r => r.json())
      .then(d => {
        // FIX: Java exception handler returns HTTP 200 + error Map (not an array).
        // Calling .filter() on a Map crashes React → white screen.
        const safe = Array.isArray(d) ? d : [];
        if (!Array.isArray(d)) setError(`API error: ${d?.message || "unexpected response"}`);
        setAlerts(safe);
        setFiltered(safe);
      })
      .catch(() => setError(`Cannot reach Transaction Service at ${TRANSACTION_URL}`))
      .finally(() => setLoadingData(false));
  }, []);

  const runAI = useCallback(async () => {
    if (!search.trim()) { setFiltered(alerts); return; }
    setLoadingAI(true);
    try {
      const r = await fetch(`${TRANSACTION_URL}/ai-search`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: search }),
      });
      const p = await r.json();
      setFiltered(alerts.filter(a => {
        if (p.caseId     && !a.caseId?.toLowerCase().includes(p.caseId.toLowerCase()))     return false;
        if (p.customerId && a.customerId?.toString() !== p.customerId?.toString())          return false;
        if (p.severity   && a.severity !== p.severity)                                      return false;
        if (p.rules?.length && !p.rules.some(r => a.ruleHits?.includes(r)))                return false;
        if (p.name       && !a.clientName?.toLowerCase().includes(p.name.toLowerCase()))   return false;
        return true;
      }));
    } catch {
      const lc = search.toLowerCase();
      setFiltered(alerts.filter(a =>
        [a.caseId, a.customerId, a.clientName, a.severity, ...(a.ruleHits||[])].join(" ").toLowerCase().includes(lc)
      ));
    } finally { setLoadingAI(false); }
  }, [search, alerts]);

  useEffect(() => {
    if (searchMode !== "ai") return;
    const t = setTimeout(runAI, 300);
    return () => clearTimeout(t);
  }, [search, searchMode, runAI]);

  useEffect(() => {
    if (searchMode !== "manual") return;
    const f = manualF;
    setFiltered(alerts.filter(a => {
      if (f.caseId     && !a.caseId?.toLowerCase().includes(f.caseId.toLowerCase()))     return false;
      if (f.customerId && !a.customerId?.toString().includes(f.customerId))               return false;
      if (f.clientName && !a.clientName?.toLowerCase().includes(f.clientName.toLowerCase())) return false;
      if (f.severity   && !a.severity?.toLowerCase().includes(f.severity.toLowerCase()))  return false;
      if (f.rules      && !(a.ruleHits||[]).join(" ").toLowerCase().includes(f.rules.toLowerCase())) return false;
      return true;
    }));
  }, [manualF, alerts, searchMode]);

  const suggestions = useMemo(() => {
    const v = [];
    alerts.forEach(a => {
      [a.customerId, a.clientName, a.severity, a.caseId].filter(Boolean).forEach(x => v.push(String(x)));
      (a.ruleHits||[]).forEach(r => v.push(r));
    });
    return [...new Set(v)];
  }, [alerts]);

  const dropItems = useMemo(() =>
    suggestions.filter(s => s && search && s.toLowerCase().includes(search.toLowerCase())).slice(0, 6),
    [suggestions, search]
  );

  const counts = useMemo(() => ({
    high:   alerts.filter(a => a.severity === "HIGH").length,
    medium: alerts.filter(a => a.severity === "MEDIUM").length,
    low:    alerts.filter(a => a.severity === "LOW").length,
    scored: alerts.filter(a => a.anomalyScore > 0).length,
  }), [alerts]);

  const switchMode = m => { setSearchMode(m); setSearch(""); setManualF({caseId:"",customerId:"",clientName:"",severity:"",rules:""}); setFiltered(alerts); };
  const uniqueVals = f => [...new Set(alerts.map(a => f === "rules" ? (a.ruleHits||[]).join(", ") : a[f]).filter(Boolean))];

  return (
    <div className="tab-body">
      <div className="section-hdr">
        <h2>Transaction Monitoring</h2>
        <p>Java Spring Boot :8083 → PostgreSQL + Python IsolationForest :5000</p>
      </div>

      <div className="stats-row">
        <StatCard label="High Risk"   value={counts.high}   accent="#ef4444" sub="Immediate review" />
        <StatCard label="Medium Risk" value={counts.medium} accent="#f59e0b" sub="Investigate" />
        <StatCard label="Low Risk"    value={counts.low}    accent="#22c55e" sub="Monitor" />
        <StatCard label="Total"       value={alerts.length} accent="#6366f1" sub="All customers" />
        <StatCard label="ML-Scored"   value={counts.scored} accent="#06b6d4" sub="IsolationForest" />
      </div>

      <div className="search-hdr">
        <div className="mode-tabs">
          <button className={`tab ${searchMode==="ai"?"tab-on":""}`} onClick={() => switchMode("ai")}>AI Search</button>
          <button className={`tab ${searchMode==="manual"?"tab-on":""}`} onClick={() => switchMode("manual")}>⊞ Manual</button>
        </div>
        <span className="result-ct">{filtered.length} / {alerts.length}</span>
      </div>

      {searchMode === "ai" && (
        <div className="srch-wrap">
          <input className="srch" placeholder='Try: "high severity customer 1234" or "rapid movement"'
            value={search} onChange={e => { setSearch(e.target.value); setDropdown(true); }}
            onBlur={() => setTimeout(() => setDropdown(false), 160)} />
          {loadingAI && <span className="spin-sm" />}
          {dropdown && search && dropItems.length > 0 && (
            <div className="dropdown">
              {dropItems.map((s,i) => <div key={i} className="dd-item" onMouseDown={() => { setSearch(s); setDropdown(false); }}>{s}</div>)}
            </div>
          )}
        </div>
      )}

      {searchMode === "manual" && (
        <div className="manual-grid">
          {Object.entries(manualF).map(([k, v]) => (
            <div key={k} className="mf">
              <label>{k}</label>
              <input list={`dl-${k}`} className="srch" placeholder={`Filter by ${k}`}
                value={v} onChange={e => setManualF(f => ({ ...f, [k]: e.target.value }))} />
              <datalist id={`dl-${k}`}>{uniqueVals(k).map((x,i) => <option key={i} value={x} />)}</datalist>
            </div>
          ))}
        </div>
      )}

      {error      && <div className="err-bar">{error}</div>}
      {loadingData && <Loader text="Loading alerts from Java Transaction Service…" />}

      {!loadingData && (
        <div className="tbl-wrap">
          <table>
            <thead><tr>
              <th>Case ID</th><th>Customer</th><th>Name</th><th>Severity</th>
              <th title="Python IsolationForest score">ML Score ↗</th><th>Rules</th><th>Amount</th><th>Txns</th>
            </tr></thead>
            <tbody>
              {filtered.length === 0
                ? <tr><td colSpan={8} className="no-rows">No matching cases</td></tr>
                : filtered.map((a,i) => (
                  <tr key={i} className={`row-${(a.severity||"low").toLowerCase()}`}>
                    <td className="mono">{a.caseId}</td>
                    <td>{a.customerId}</td>
                    <td>{a.clientName}</td>
                    <td><Pill v={a.severity} map={{HIGH:"pill-high",MEDIUM:"pill-med",LOW:"pill-low"}} /></td>
                    <td><MlBar score={a.anomalyScore} /></td>
                    <td><div className="rules-cell">{(a.ruleHits||[]).length>0
                      ? a.ruleHits.map((r,ri) => <span key={ri} className="rule-tag">{r}</span>)
                      : <span className="no-rule">—</span>}</div></td>
                    <td className="mono">₹{a.totalTransactionAmount?.toLocaleString("en-IN")}</td>
                    <td>{a.transactionCount}</td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function MlBar({ score }) {
  const n = parseFloat(score) || 0;
  const c = n >= 70 ? "#ef4444" : n >= 40 ? "#f59e0b" : "#22c55e";
  return (
    <div className="ml-wrap">
      <div className="ml-bg"><div className="ml-fill" style={{ width: `${n}%`, background: c }} /></div>
      <span className="ml-num" style={{ color: c }}>{n.toFixed(1)}</span>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TAB 3 — RISK RATING
// ──────────────────────────────────────────────────────────────

function RiskRatingTab() {
  const [customers, setCustomers] = useState([]);
  const [id,        setId]        = useState("1");
  const [result,    setResult]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [loadingAll,setLoadingAll]= useState(true);
  const [error,     setError]     = useState("");

  useEffect(() => {
    fetch(`${RISK_URL}/api/customer`)
      .then(r => r.json())
      .then(setCustomers)
      .catch(() => setError(`Cannot reach Risk Service at ${RISK_URL}`))
      .finally(() => setLoadingAll(false));
  }, []);

  const norm = v => {
    if (!v) return false;
    const s = v.toString().trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  };

  const calcScore = c => {
    let s = 0;
    if (norm(c.isPEP))            s += 30;
    if (norm(c.hasAdverseMedia))  s += 25;
    if (norm(c.highRiskCountry))  s += 20;
    if (norm(c.highRiskBusiness)) s += 15;
    return s;
  };

  const scoreLevel = s => s >= 80 ? "Critical" : s >= 60 ? "High" : s >= 30 ? "Medium" : "Low";
  const levelCls   = l => ({ Critical:"pill-high", High:"pill-high", Medium:"pill-med", Low:"pill-low" })[l] || "pill-low";

  const calculate = async (e) => {
    e?.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await fetch(`${RISK_URL}/api/customer/calculate-risk/${id}`, { method: "POST" });
      const d = await r.json();
      setResult(d);
    } catch (err) {
      setError("Risk calculation failed: " + err.message);
    } finally { setLoading(false); }
  };

  const riskCounts = useMemo(() => {
    let critical=0, high=0, medium=0, low=0;
    customers.forEach(c => {
      const lv = scoreLevel(calcScore(c));
      if (lv === "Critical") critical++;
      else if (lv === "High") high++;
      else if (lv === "Medium") medium++;
      else low++;
    });
    return { critical, high, medium, low };
  }, [customers]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="tab-body">
      <div className="section-hdr">
        <h2>Risk Rating</h2>
        <p>.NET Core :8081 → Python FastAPI ML :8000 (IsolationForest on PEP, adverse media, country, business risk)</p>
      </div>

      <div className="stats-row">
        <StatCard label="Critical" value={riskCounts.critical} accent="#dc2626" />
        <StatCard label="High"     value={riskCounts.high}     accent="#ef4444" />
        <StatCard label="Medium"   value={riskCounts.medium}   accent="#f59e0b" />
        <StatCard label="Low"      value={riskCounts.low}      accent="#22c55e" />
        <StatCard label="Total"    value={customers.length}    accent="#6366f1" />
      </div>

      <div className="section-hdr" style={{ marginTop: 24 }}>
        <h3>Calculate Risk for a Customer</h3>
      </div>

      <form className="id-form" onSubmit={calculate}>
        <input value={id} onChange={e => setId(e.target.value)} placeholder="Customer ID" />
        <button type="submit" disabled={loading}>{loading ? "Calculating…" : "Calculate Risk"}</button>
      </form>

      {error   && <div className="err-bar">{error}</div>}
      {loading && <Loader text="Calling .NET Risk Service → Python ML…" />}

      {result && !loading && (
        <div className="result-card">
          <div className="rc-row">
            <div className="rc-field"><label>Customer</label><strong>{result.name || result.Name}</strong></div>
            <div className="rc-field"><label>Final Risk Score</label><strong style={{ fontSize: 32 }}>{result.finalRisk ?? result.FinalRisk}</strong></div>
            <div className="rc-field"><label>Category</label>
              <span className={`pill ${levelCls(result.category || result.Category)}`}>{result.category || result.Category}</span>
            </div>
          </div>
          <div className="rc-row">
            <div className="rc-field"><label>Base Risk (rules)</label><strong>{result.baseRisk ?? result.BaseRisk}</strong></div>
            <div className="rc-field"><label>ML Risk (anomaly)</label><strong>{result.mlRisk ?? result.MLRisk}</strong></div>
          </div>
        </div>
      )}

      {loadingAll && <Loader text="Loading customers from .NET Risk Service…" />}

      {!loadingAll && (
        <div className="tbl-wrap" style={{ marginTop: 24 }}>
          <table>
            <thead><tr>
              <th>ID</th><th>Name</th><th>PEP</th><th>Adverse Media</th>
              <th>High-Risk Country</th><th>High-Risk Business</th>
              <th>Score</th><th>Level</th>
            </tr></thead>
            <tbody>
              {customers.map((c) => {
                const score = calcScore(c);
                const level = scoreLevel(score);
                return (
                  <tr key={c.customerId} className={`row-${level.toLowerCase()}`}>
                    <td>{c.customerId}</td>
                    <td>{c.name}</td>
                    <td>{norm(c.isPEP) ? "Yes" : "—"}</td>
                    <td>{norm(c.hasAdverseMedia) ? "Yes" : "—"}</td>
                    <td>{norm(c.highRiskCountry) ? "Yes" : "—"}</td>
                    <td>{norm(c.highRiskBusiness) ? "Yes" : "—"}</td>
                    <td><strong>{score}</strong></td>
                    <td><Pill v={level} map={{ Critical:"pill-high", High:"pill-high", Medium:"pill-med", Low:"pill-low" }} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TAB 5 — ANALYTICS
// ──────────────────────────────────────────────────────────────

const CHART_COLORS = {
  HIGH:     "#ef4444",
  MEDIUM:   "#f59e0b",
  LOW:      "#22c55e",
  Critical: "#dc2626",
  High:     "#ef4444",
  Medium:   "#eab308",   // yellow for Medium in Risk Level pie
  Low:      "#22c55e",   // green for Low in Risk Level pie
  MATCH:    "#ef4444",
  CLEAR:    "#22c55e",
  palette:  ["#6366f1","#22c55e","#f59e0b","#ef4444","#06b6d4","#a855f7","#ec4899"],
};

function AnalyticsTab() {
  const [alerts,    setAlerts]    = useState([]);
  const [customers, setCustomers] = useState([]);
  const [bulk,      setBulk]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState("");

  useEffect(() => {
    setLoading(true);
    Promise.allSettled([
      fetch(`${TRANSACTION_URL}/monitor`).then(r => r.json()),
      fetch(`${RISK_URL}/api/customer`).then(r => r.json()),
      fetch(`${SCREENING_URL}/screen/bulk`).then(r => r.json()),
    ]).then(([txRes, riskRes, screenRes]) => {
      if (txRes.status     === "fulfilled" && Array.isArray(txRes.value))    setAlerts(txRes.value);
      if (riskRes.status   === "fulfilled" && Array.isArray(riskRes.value))  setCustomers(riskRes.value);
      if (screenRes.status === "fulfilled" && Array.isArray(screenRes.value)) setBulk(screenRes.value);
      if (txRes.status === "rejected" && riskRes.status === "rejected")
        setError("Could not reach services. Make sure all backends are running.");
    }).finally(() => setLoading(false));
  }, []);

  // ── helper ──────────────────────────────────────────────────
  const normBool = v => {
    const s = (v ?? "").toString().trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  };
  const calcScore = c => {
    let s = 0;
    if (normBool(c.isPEP))            s += 30;
    if (normBool(c.hasAdverseMedia))  s += 25;
    if (normBool(c.highRiskCountry))  s += 20;
    if (normBool(c.highRiskBusiness)) s += 15;
    return s;
  };
  const scoreLevel = s => s >= 80 ? "Critical" : s >= 60 ? "High" : s >= 30 ? "Medium" : "Low";

  // ── chart datasets ──────────────────────────────────────────

  // 1. Alerts by severity
  const severityData = useMemo(() => {
    const c = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    alerts.forEach(a => { if (c[a.severity] !== undefined) c[a.severity]++; });
    return Object.entries(c).map(([name, value]) => ({ name, value }));
  }, [alerts]);

  // 2. Risk level distribution
  const riskPieData = useMemo(() => {
    const c = { Critical: 0, High: 0, Medium: 0, Low: 0 };
    customers.forEach(cu => { c[scoreLevel(calcScore(cu))]++; }); // eslint-disable-line react-hooks/exhaustive-deps
    return Object.entries(c).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [customers]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. Screening match vs clear
  const screenData = useMemo(() => [
    { name: "MATCH", value: bulk.filter(b => b.match).length },
    { name: "CLEAR", value: bulk.filter(b => !b.match).length },
  ], [bulk]);

  // 4. ML anomaly score histogram (buckets of 10)
  const mlHistogram = useMemo(() => {
    const buckets = Array.from({ length: 10 }, (_, i) => ({ range: `${i*10}–${i*10+9}`, count: 0 }));
    alerts.forEach(a => {
      const idx = Math.min(Math.floor((parseFloat(a.anomalyScore) || 0) / 10), 9);
      buckets[idx].count++;
    });
    return buckets;
  }, [alerts]);

  // 5. Total transaction amount by severity
  const amountBySeverity = useMemo(() => {
    const sums = { HIGH: 0, MEDIUM: 0, LOW: 0 };
    alerts.forEach(a => { if (sums[a.severity] !== undefined) sums[a.severity] += parseFloat(a.totalTransactionAmount) || 0; });
    return Object.entries(sums).map(([name, value]) => ({ name, value: Math.round(value) }));
  }, [alerts]);

  // 6. Top rule hits
  const rulePieData = useMemo(() => {
    const freq = {};
    alerts.forEach(a => (a.ruleHits || []).forEach(r => { freq[r] = (freq[r] || 0) + 1; }));
    return Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 7)
      .map(([name, value]) => ({ name, value }));
  }, [alerts]);

  const fmtINR = v => `₹${(v / 100000).toFixed(1)}L`;

  const Panel = ({ title, info, legend, children }) => (
    <div className="chart-panel">
      <div className="chart-panel-header">
        <span className="chart-panel-title">{title}</span>
        {info && (
          <span className="chart-info-wrap">
            <span className="chart-info-icon">ℹ</span>
            <div className="chart-info-popup">
              <div className="chart-info-desc">{info}</div>
              {legend && legend.length > 0 && (
                <div className="chart-info-legend">
                  {legend.map(({ color, label }) => (
                    <div key={label} className="chart-info-legend-row">
                      <span className="chart-info-swatch" style={{ background: color }} />
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </span>
        )}
      </div>
      {children}
    </div>
  );

  return (
    <div className="tab-body">
      <div className="section-hdr">
        <h2>Analytics Dashboard</h2>
        <p>Aggregated view across Transaction Monitoring :8083, Risk Rating :8081, and Screening :8082</p>
      </div>

      {error   && <div className="err-bar">{error}</div>}
      {loading && <Loader text="Fetching data from all services…" />}

      {!loading && (
        <>
          <div className="stats-row">
            <StatCard label="Total Alerts"   value={alerts.length}                                         accent="#6366f1" />
            <StatCard label="High Severity"  value={severityData.find(d => d.name === "HIGH")?.value ?? 0} accent="#ef4444" />
            <StatCard label="Customers"      value={customers.length}                                       accent="#06b6d4" />
            <StatCard label="Watchlist Hits" value={screenData.find(d => d.name === "MATCH")?.value ?? 0}  accent="#f59e0b" />
            <StatCard label="Screened"       value={bulk.length}                                            accent="#22c55e" />
          </div>

          <div className="charts-grid">

            <Panel title="Alerts by Severity"
              info="Shows the count of transaction monitoring alerts grouped by severity level. Alerts are generated by the rule engine and ML anomaly scorer — higher bars indicate more flagged customers at that risk tier."
              legend={[
                { color: CHART_COLORS.HIGH,   label: "HIGH — 3+ rule hits or ML score ≥ 70 or total > ₹3.5Cr" },
                { color: CHART_COLORS.MEDIUM, label: "MEDIUM — 2+ rule hits or ML score ≥ 55 or total > ₹2Cr" },
                { color: CHART_COLORS.LOW,    label: "LOW — below ₹3Cr total transaction volume" },
              ]}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={severityData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={<ChartTooltip
                      valueFmt={(v) => `${v} alert${v !== 1 ? "s" : ""}`}
                      labelFmt={(l) => `Severity: ${l}`}
                    />}
                  />
                  <Bar dataKey="value" name="Alerts" radius={[4, 4, 0, 0]}>
                    {severityData.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name] || "#6366f1"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Risk Level Distribution"
              info="Displays the breakdown of all 1,500 customers by their computed risk level. Risk score is calculated from KYC flags: PEP (+30), Adverse Media (+25), High-Risk Country (+20), High-Risk Business (+15). The ML service adds an anomaly bonus on top."
              legend={[
                { color: CHART_COLORS.Critical, label: "Critical — score ≥ 80" },
                { color: CHART_COLORS.High,     label: "High — score 60–79" },
                { color: CHART_COLORS.Medium,   label: "Medium — score 30–59" },
                { color: CHART_COLORS.Low,      label: "Low — score 0–29" },
              ]}
            >
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={riskPieData} cx="50%" cy="50%" outerRadius={80} dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {riskPieData.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name] || CHART_COLORS.palette[i % 7]} />)}
                  </Pie>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const total = riskPieData.reduce((s, d) => s + d.value, 0);
                      const { name, value } = payload[0].payload;
                      const pct = total ? ((value / total) * 100).toFixed(1) : 0;
                      return (
                        <div className="chart-tooltip">
                          <div className="ct-label">Risk Level</div>
                          <div className="ct-row">
                            <span className="ct-dot" style={{ background: payload[0].payload.fill || CHART_COLORS[name] || "#6366f1" }} />
                            <span className="ct-name">{name}</span>
                            <span className="ct-val">{value} customers ({pct}%)</span>
                          </div>
                        </div>
                      );
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Screening: Match vs Clear"
              info="Compares customers who were flagged as a watchlist match against those that were cleared during bulk AML screening. Matches are identified using fuzzy name matching, ID cross-referencing, and entity correlation against OFAC, UN, EU, SEBI, and INTERPOL lists."
              legend={[
                { color: CHART_COLORS.MATCH, label: "MATCH — potential watchlist hit requiring review" },
                { color: CHART_COLORS.CLEAR, label: "CLEAR — no match found across all watchlist sources" },
              ]}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={screenData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={<ChartTooltip
                      valueFmt={(v, p) => {
                        const total = screenData.reduce((s, d) => s + d.value, 0);
                        const pct = total ? ((v / total) * 100).toFixed(1) : 0;
                        return `${v} customers (${pct}%)`;
                      }}
                      labelFmt={(l) => l === "MATCH" ? "Watchlist Match" : "Clear"}
                    />}
                  />
                  <Bar dataKey="value" name="Customers" radius={[4, 4, 0, 0]}>
                    {screenData.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name] || "#6366f1"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="ML Anomaly Score Distribution"
              info="Shows how ML anomaly scores (1–99) are distributed across monitored customers. Scores are produced by an IsolationForest model trained on transaction volume, count, average, max/min amounts, and bank activity ratios. Peaks in higher ranges indicate more anomalous behaviour."
              legend={[
                { color: "#6366f1", label: "Score 0–39 — normal behaviour" },
                { color: "#f59e0b", label: "Score 40–69 — elevated anomaly signal" },
                { color: "#ef4444", label: "Score 70–99 — high anomaly, triggers HIGH severity" },
              ]}
            >
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={mlHistogram} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="range" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={<ChartTooltip
                      valueFmt={(v) => `${v} customer${v !== 1 ? "s" : ""}`}
                      labelFmt={(l) => `Score range: ${l}`}
                    />}
                  />
                  <Line type="monotone" dataKey="count" name="Count" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} />
                </LineChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Transaction Amount by Severity"
              info="Compares the total cumulative transaction value (in ₹ Lakhs) across all customers grouped by their alert severity. Larger bars at HIGH indicate that the highest-risk customers also account for the most financial throughput — a key AML signal."
              legend={[
                { color: CHART_COLORS.HIGH,   label: "HIGH — combined total for all high-severity customers" },
                { color: CHART_COLORS.MEDIUM, label: "MEDIUM — combined total for medium-severity customers" },
                { color: CHART_COLORS.LOW,    label: "LOW — combined total for low-severity customers" },
              ]}
            >
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={amountBySeverity} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(128,128,128,0.15)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={fmtINR} tick={{ fontSize: 11 }} />
                  <Tooltip
                    content={<ChartTooltip
                      valueFmt={(v) => `₹${v.toLocaleString("en-IN")} (${fmtINR(v)})`}
                      labelFmt={(l) => `Severity: ${l}`}
                    />}
                  />
                  <Bar dataKey="value" name="Total Amount" radius={[4, 4, 0, 0]}>
                    {amountBySeverity.map((e, i) => <Cell key={i} fill={CHART_COLORS[e.name] || "#6366f1"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Panel>

            <Panel title="Top Rule Hits"
              info="Pie chart of the most frequently triggered AML detection rules across all monitored customers. Each slice represents how often a specific rule contributed to an alert. Dominant rules reveal the most common suspicious patterns in the dataset."
              legend={[
                { color: CHART_COLORS.palette[0], label: "LARGE_TRANSACTION_VOLUME — total exceeds ₹3Cr" },
                { color: CHART_COLORS.palette[1], label: "MULTIPLE_HIGH_VALUE_TRANSACTIONS — 2+ txns over ₹45L" },
                { color: CHART_COLORS.palette[2], label: "STRUCTURING_PATTERN — 2+ txns just below ₹10L threshold" },
                { color: CHART_COLORS.palette[3], label: "RAPID_MOVEMENT — burst activity across multiple days" },
                { color: CHART_COLORS.palette[4], label: "TRADE_TRANSACTION_MISMATCH — trades with no banking records" },
              ]}
            >
              {rulePieData.length === 0
                ? <div style={{ padding: "60px 0", textAlign: "center", opacity: 0.4, fontSize: 13 }}>No rule data available</div>
                : (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={rulePieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" nameKey="name">
                        {rulePieData.map((_, i) => <Cell key={i} fill={CHART_COLORS.palette[i % 7]} />)}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const total = rulePieData.reduce((s, d) => s + d.value, 0);
                          const { name, value } = payload[0].payload;
                          const pct = total ? ((value / total) * 100).toFixed(1) : 0;
                          const color = CHART_COLORS.palette[rulePieData.findIndex(d => d.name === name) % 7];
                          return (
                            <div className="chart-tooltip">
                              <div className="ct-label">Rule Hit</div>
                              <div className="ct-row">
                                <span className="ct-dot" style={{ background: color }} />
                                <span className="ct-name">{name}</span>
                                <span className="ct-val">{value} hits ({pct}%)</span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Legend formatter={v => v.length > 20 ? v.slice(0, 20) + "…" : v} />
                    </PieChart>
                  </ResponsiveContainer>
                )
              }
            </Panel>

          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// TAB 4 — SCREENING
// ──────────────────────────────────────────────────────────────

function ScreeningTab() {
  const [id,       setId]       = useState("1");
  const [result,   setResult]   = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [bulk,     setBulk]     = useState([]);
  const [loadBulk, setLoadBulk] = useState(false);
  const [error,    setError]    = useState("");

  const screen = async (e) => {
    e?.preventDefault();
    setLoading(true); setError(""); setResult(null);
    try {
      const r = await fetch(`${SCREENING_URL}/screen/by-customer/${id.trim()}`);
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResult(d);
    } catch (err) {
      setError("Screening failed: " + err.message);
    } finally { setLoading(false); }
  };

  const runBulk = async () => {
    setLoadBulk(true); setError("");
    try {
      const r = await fetch(`${SCREENING_URL}/screen/bulk`);
      const d = await r.json();
      setBulk(d);
    } catch (err) {
      setError("Bulk screening failed: " + err.message);
    } finally { setLoadBulk(false); }
  };

  const bulkCounts = useMemo(() => ({
    matched: bulk.filter(b => b.match).length,
    clear:   bulk.filter(b => !b.match).length,
  }), [bulk]);

  return (
    <div className="tab-body">
      <div className="section-hdr">
        <h2>Watchlist Screening</h2>
        <p>Python Flask :8082 → PostgreSQL watchlist (strong ID match + fuzzy name/email matching)</p>
      </div>

      <form className="id-form" onSubmit={screen}>
        <input value={id} onChange={e => setId(e.target.value)} placeholder="Customer ID" />
        <button type="submit" disabled={loading}>{loading ? "Screening…" : "Screen Customer"}</button>
        <button type="button" className="btn-sec" onClick={runBulk} disabled={loadBulk}>
          {loadBulk ? "Running…" : "Bulk Screen All"}
        </button>
      </form>

      {error   && <div className="err-bar">{error}</div>}
      {loading && <Loader text="Screening against watchlist…" />}

      {result && !loading && (
        <div className={`screen-result ${result.match ? "screen-match" : "screen-clear"}`}>
          <div className="sr-head">
            <span className="sr-icon">{result.match ? "!" : "+"}</span>
            <span className="sr-title">{result.match ? "WATCHLIST MATCH" : "CLEAR — No Match"}</span>
            <span className={`pill ${result.match ? "pill-high" : "pill-low"}`}>{result.riskLevel}</span>
          </div>
          <div className="sr-fields">
            <div><label>Customer</label><strong>{result.name}</strong></div>
            <div><label>Match Type</label><strong>{result.matchType}</strong></div>
            <div><label>Confidence</label><strong>{result.confidence}%</strong></div>
            {result.match && <><div><label>List</label><strong>{result.list}</strong></div>
            <div><label>Matched Name</label><strong>{result.matchedName}</strong></div>
            <div><label>Reason</label><strong>{result.reason || "—"}</strong></div></>}
          </div>
        </div>
      )}

      {bulk.length > 0 && (
        <>
          <div className="stats-row" style={{ marginTop: 24 }}>
            <StatCard label="Watchlist Matches" value={bulkCounts.matched} accent="#ef4444" />
            <StatCard label="Clear"             value={bulkCounts.clear}   accent="#22c55e" />
            <StatCard label="Total Screened"    value={bulk.length}        accent="#6366f1" />
          </div>
          <div className="tbl-wrap">
            <table>
              <thead><tr><th>Customer ID</th><th>Name</th><th>Result</th><th>Match Type</th><th>Confidence</th><th>Risk</th></tr></thead>
              <tbody>
                {bulk.map((b, i) => (
                  <tr key={i} className={b.match ? "row-high" : ""}>
                    <td>{b.customerId}</td><td>{b.name}</td>
                    <td><Pill v={b.match ? "MATCH" : "CLEAR"} map={{ MATCH:"pill-high", CLEAR:"pill-low" }} /></td>
                    <td>{b.matchType}</td>
                    <td>{b.confidence}%</td>
                    <td><Pill v={b.riskLevel} map={{ HIGH:"pill-high", MEDIUM:"pill-med", LOW:"pill-low" }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ──────────────────────────────────────────────────────────────
// ROOT APP
// ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "profile",      label: "Full Profile"  },
  { id: "transactions", label: "Transactions"  },
  { id: "risk",         label: "Risk Rating"   },
  { id: "screening",    label: "Screening"     },
  { id: "analytics",    label: "Analytics"     },
];

const SVCS = [
  { key: "gateway",           label: "Gateway",     sub: "Java :8080"  },
  { key: "riskService",       label: "Risk",        sub: ".NET :8081"  },
  { key: "screeningService",  label: "Screening",   sub: "Python :8082"},
  { key: "transactionService",label: "Transactions",sub: "Java :8083"  },
];

export default function App() {
  const [tab,    setTab]    = useState("profile");
  const [health, setHealth] = useState(Object.fromEntries(SVCS.map(s => [s.key, "CHECKING"])));
  const [dark,   setDark]   = useState(true);

  useEffect(() => {
    fetch(`${GATEWAY_URL}/health`)
      .then(r => r.json())
      .then(d => setHealth(h => ({ ...h, ...d })))
      .catch(() => setHealth(h => ({ ...h, gateway: "DOWN" })));
  }, []);

  return (
    <div className={`shell ${dark ? "dark" : "light"}`}>
      {/* ── TOP BAR ── */}
      <header className="topbar">
        <div>
          <p className="eyebrow">Unified AML Platform</p>
          <h1>AML Dashboard</h1>
        </div>
        <div className="topbar-right">
          <div className="svc-bar">
            {SVCS.map(s => <Svc key={s.key} label={s.label} sub={s.sub} status={health[s.key]} />)}
          </div>
          <button className="theme-btn" onClick={() => setDark(d => !d)}>
            {dark ? "Light" : "Dark"}
          </button>
        </div>
      </header>

      {/* ── ARCHITECTURE FLOW ── */}
      <div className="flow-bar">
        <span className="fl">React :5173</span>
        <span className="fa">→</span>
        <span className="fl java">Gateway :8080</span>
        <span className="fa">→</span>
        <span className="fl net">.NET Risk :8081</span>
        <span className="fa">+</span>
        <span className="fl py">Python Screening :8082</span>
        <span className="fa">+</span>
        <span className="fl java">Java Transactions :8083</span>
        <span className="fa">→</span>
        <span className="fl py">Python ML :5000/:8000</span>
        <span className="fa">→</span>
        <span className="fl db">PostgreSQL</span>
      </div>

      {/* ── TABS ── */}
      <nav className="tab-nav">
        {TABS.map(t => (
          <button key={t.id} className={`nav-tab ${tab===t.id?"nav-on":""}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {/* ── TAB CONTENT ── */}
      {tab === "profile"      && <ProfileTab />}
      {tab === "transactions" && <TransactionsTab />}
      {tab === "risk"         && <RiskRatingTab />}
      {tab === "screening"    && <ScreeningTab />}
      {tab === "analytics"    && <AnalyticsTab />}

      <footer className="footer">
        React :5173 → Java Gateway :8080 → .NET Risk :8081 + Python Screening :8082 + Java Transactions :8083
      </footer>
    </div>
  );
}

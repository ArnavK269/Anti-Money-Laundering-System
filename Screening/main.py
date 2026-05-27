import pandas as pd
import streamlit as st
import requests
import json
import re
import os
from rapidfuzz import fuzz
import psycopg # type: ignore
from psycopg.rows import dict_row # type: ignore
from io import StringIO
import threading
import time
from datetime import datetime, timedelta

# =========================================================
# PAGE CONFIG
# =========================================================
st.set_page_config(
    page_title="AML AI Assistant",
    page_icon="🛡️",
    layout="wide"
)

# =========================================================
# SESSION STATE
# =========================================================
if "last_screening_time" not in st.session_state:
    st.session_state.last_screening_time = None

if "screening_results" not in st.session_state:
    st.session_state.screening_results = []

if "next_screening" not in st.session_state:

    now = datetime.now()

    next_run = now.replace(
        hour=8,
        minute=0,
        second=0,
        microsecond=0
    )

    if now >= next_run:
        next_run += timedelta(days=1)

    st.session_state.next_screening = next_run

# =========================================================
# CUSTOM CSS
# =========================================================
st.markdown("""
<style>

.block-container {
    padding-top: 1rem;
    padding-bottom: 1rem;
    max-width: 95%;
}

div[data-testid="stVerticalBlock"] {
    gap: 0.6rem;
}

.stTextArea textarea {
    border-radius: 12px;
    min-height: 140px;
    font-size: 15px;
}

.stButton button {
    width: 100%;
    border-radius: 10px;
    height: 45px;
    font-weight: 600;
}

.metric-card {
    background: #111827;
    padding: 18px;
    border-radius: 12px;
    border: 1px solid #374151;
    margin-bottom: 14px;
    min-height: 95px;
}

.small-text {
    font-size: 13px;
    color: gray;
}

.big-text {
    font-size: 16px;
    font-weight: 600;
}

</style>
""", unsafe_allow_html=True)

# =========================================================
# CONFIG
# =========================================================
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_NAME = os.getenv("DB_NAME", "aml_db")
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_PORT = os.getenv("DB_PORT", "5432")

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
WEB_SEARCH_ENABLED = os.getenv("WEB_SEARCH_ENABLED", "true").lower() == "true"
OLLAMA_WEB_URL = "https://ollama.com/api/web_search"
OLLAMA_API_KEY = os.getenv("OLLAMA_API_KEY", "")


WATCHLIST_COLUMNS = [
    "name",
    "alias",
    "address",
    "phone",
    "phone2",
    "email",
    "email2",
    "city",
    "pan",
    "aadhaar",
    "passport",
    "voter_id",
    "driving_license",
    "source",
    "country",
    "type",
    "reason",
    "link",
]

COMPARISON_FIELDS = [
    "name",
    "alias",
    "address",
    "phone",
    "phone2",
    "email",
    "email2",
    "city",
    "pan",
    "aadhaar",
    "passport",
    "voter_id",
    "driving_license",
]

UNIQUE_FIELDS = [
    "pan",
    "aadhaar",
    "passport",
    "voter_id",
    "driving_license"
]

# =========================================================
# DATABASE CONNECTION
# =========================================================
def get_connection():

    return psycopg.connect(
        host=DB_HOST,
        dbname=DB_NAME,
        user=DB_USER,
        password=DB_PASSWORD,
        port=DB_PORT,
        row_factory=dict_row,
    )

# =========================================================
# LOAD WATCHLIST
# =========================================================
@st.cache_data(show_spinner=False)
def load_watchlist():

    try:

        with get_connection() as conn:

            with conn.cursor() as cur:

                cur.execute("SELECT * FROM watchlist")

                rows = cur.fetchall()

        df = pd.DataFrame(rows)

        if df.empty:
            return pd.DataFrame(columns=WATCHLIST_COLUMNS)

        df.columns = [str(c).strip().lower() for c in df.columns]

        for col in WATCHLIST_COLUMNS:

            if col not in df.columns:
                df[col] = pd.NA

        return df

    except Exception as e:

        st.error(f"Could not load watchlist: {e}")

        return pd.DataFrame(columns=WATCHLIST_COLUMNS)

# =========================================================
# LOAD DATA
# =========================================================
wt = load_watchlist()

for col in WATCHLIST_COLUMNS:

    if col not in wt.columns:
        wt[col] = pd.NA

    wt[col] = wt[col].fillna("").astype(str)

# =========================================================
# NORMALIZED COLUMNS
# =========================================================
normalize_cols = [
    "name",
    "alias",
    "email",
    "email2",
    "phone",
    "phone2",
    "pan",
    "aadhaar",
    "passport",
    "voter_id",
    "driving_license",
    "city"
]

for col in normalize_cols:

    wt[f"_{col}_norm"] = (
        wt[col]
        .astype(str)
        .str.strip()
        .str.lower()
    )

# =========================================================
# HEADER UI
# =========================================================
st.title("🛡️ AML AI Assistant")

col1, col2 = st.columns([5, 1])

with col1:

    user_prompt = st.text_area(
        "",
        placeholder="""
Example:

Rohan Mehta lives in Mumbai.
PAN is ABCDE1234F.
Passport is K1234567.
Phone is +919876543210
        """,
        label_visibility="collapsed"
    )

with col2:

    st.markdown("<br>", unsafe_allow_html=True)

    analyze_btn = st.button("🔍 Analyze")

st.caption(
    "AI can make mistakes. Verify important information before taking compliance decisions."
)

# =========================================================
# CSV BULK SCREENING
# =========================================================
st.markdown("### 📂 Bulk CSV Screening")

uploaded_files = st.file_uploader(
    "Upload CSV Files",
    type=["csv"],
    accept_multiple_files=True
)

# =========================================================
# HELPER FUNCTIONS
# =========================================================

def normalize_text(value):

    # HANDLE LISTS
    if isinstance(value, list):

        if len(value) > 0:
            value = value[0]
        else:
            return ""

    # HANDLE NONE
    if value is None:
        return ""

    # HANDLE NAN
    try:
        if pd.isna(value):
            return ""
    except:
        pass

    return str(value).strip()

def normalize_phone(value):

    text = normalize_text(value)

    text = re.sub(r"[ \-\(\)]", "", text)

    if text.startswith("00"):
        text = "+" + text[2:]

    return text

def normalize_pan(value):

    text = normalize_text(value)

    return re.sub(r"\s+", "", text).upper()

def normalize_generic_id(value):

    return re.sub(r"\s+", "", normalize_text(value)).upper()

def display_value(value):

    # REMOVE LIST BRACKETS
    if isinstance(value, list):

        if len(value) > 0:
            value = value[0]
        else:
            return "N/A"

    text = normalize_text(value)

    return text if text else "N/A"

def fuzzy_match_score(a, b):

    a = normalize_text(a)
    b = normalize_text(b)

    if not a or not b:
        return 0

    return fuzz.token_sort_ratio(a, b)

def extract_user_data_fallback(prompt):

    fields = [
        "name",
        "alias",
        "address",
        "phone",
        "phone2",
        "email",
        "email2",
        "city",
        "pan",
        "aadhaar",
        "passport",
        "voter_id",
        "driving_license",
    ]

    data = {field: "" for field in fields}
    text = normalize_text(prompt)

    try:
        csv_df = pd.read_csv(StringIO(text), header=None)

        if len(csv_df) == 1 and len(csv_df.columns) >= 3:
            row = csv_df.iloc[0].to_list()

            for field, value in zip(WATCHLIST_COLUMNS, row):
                if field in data:
                    data[field] = normalize_text(value)

            return data

    except Exception:
        pass

    email_matches = re.findall(
        r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}",
        text
    )
    phone_matches = re.findall(
        r"(?:\+91[\s-]?)?[6-9]\d{9}|\+?\d{7,15}",
        text
    )

    data["email"] = email_matches[0] if email_matches else ""
    data["email2"] = email_matches[1] if len(email_matches) > 1 else ""
    data["phone"] = phone_matches[0] if phone_matches else ""
    data["phone2"] = phone_matches[1] if len(phone_matches) > 1 else ""

    pan_match = re.search(r"\b[A-Z]{5}[0-9]{4}[A-Z]\b", text.upper())
    aadhaar_match = re.search(r"\b\d{12}\b", text)
    passport_match = re.search(r"\b[A-Z]{1,2}\d{6,7}\b", text.upper())
    voter_match = re.search(r"\b[A-Z]{1,3}\d{6,8}\b", text.upper())
    dl_match = re.search(r"\bDL\d{10,15}\b", text.upper())

    data["pan"] = pan_match.group(0) if pan_match else ""
    data["aadhaar"] = aadhaar_match.group(0) if aadhaar_match else ""
    data["passport"] = passport_match.group(0) if passport_match else ""
    data["voter_id"] = voter_match.group(0) if voter_match else ""
    data["driving_license"] = dl_match.group(0) if dl_match else ""

    name_match = re.search(
        r"^\s*([A-Za-z][A-Za-z .'-]+?)(?:\s+lives\b|\s+is\b|,|\.|\n)",
        text
    )

    if name_match:
        data["name"] = name_match.group(1).strip()

    return data

# =========================================================
# SAVE CUSTOMER
# =========================================================
def save_customer(data):

    try:

        with get_connection() as conn:

            with conn.cursor() as cur:

                cur.execute("""
                    INSERT INTO customers
                    (name, alias, email, phone, pan, aadhaar, passport)
                    VALUES (%s,%s,%s,%s,%s,%s,%s)
                """, (
                    data.get("name"),
                    data.get("alias"),
                    data.get("email"),
                    data.get("phone"),
                    data.get("pan"),
                    data.get("aadhaar"),
                    data.get("passport"),
                ))

                conn.commit()

    except Exception as e:

        st.error(f"Save failed: {e}")
        
# =========================================================
# BULK CSV SCREENING
# =========================================================
def screen_dataframe(df):

    results = []

    for _, customer in df.iterrows():

        customer_data = customer.to_dict()

        best_score = 0
        matched_row = None
        match_method = "No Match"

        # -------------------------------------
        # NORMALIZE INPUT
        # -------------------------------------
        for field in UNIQUE_FIELDS:

            if field in customer_data:

                customer_data[field] = normalize_text(
                    customer_data.get(field)
                )

        # -------------------------------------
        # STRONG MATCH
        # -------------------------------------
        for field in UNIQUE_FIELDS:

            input_value = normalize_text(
                customer_data.get(field)
            ).lower()

            if not input_value:
                continue

            norm_col = f"_{field}_norm"

            if norm_col not in wt.columns:
                continue

            temp = wt[
                wt[norm_col] == input_value
            ]

            if not temp.empty:

                matched_row = temp.iloc[0]

                best_score = 100

                match_method = f"Strong Match ({field})"

                break

        # -------------------------------------
        # FUZZY MATCH
        # -------------------------------------
        if matched_row is None:

            for _, row in wt.iterrows():

                name_score = fuzzy_match_score(
                    customer_data.get("name"),
                    row.get("name")
                )

                email_score = fuzzy_match_score(
                    customer_data.get("email"),
                    row.get("email")
                )

                total_score = (
                    (0.7 * name_score)
                    + (0.3 * email_score)
                )

                if total_score > best_score:

                    best_score = total_score

                    matched_row = row

            if best_score >= 85:

                match_method = (
                    f"Fuzzy Match ({best_score:.2f}%)"
                )

        # -------------------------------------
        # RESULT
        # -------------------------------------
        results.append({

            "Customer Name":
                display_value(customer_data.get("name")),

            "Email":
                display_value(customer_data.get("email")),

            "PAN":
                display_value(customer_data.get("pan")),

            "Passport":
                display_value(customer_data.get("passport")),

            "Match Type":
                match_method,

            "Confidence":
                f"{best_score:.2f}%",

            "Matched Watchlist Name":
                display_value(
                    matched_row.get("name")
                ) if matched_row is not None else "N/A",

            "Risk":
                "HIGH"
                if best_score >= 95
                else (
                    "MEDIUM"
                    if best_score >= 85
                    else "LOW"
                )
        })

    return pd.DataFrame(results)

# =========================================================
# VALIDATION
# =========================================================
def validate_user(data):

    errors = []

    if not data.get("name"):
        errors.append("Missing Name")

    if not re.match(
        r"[^@]+@[^@]+\.[^@]+",
        normalize_text(data.get("email"))
    ):
        errors.append("Invalid Email")

    if not re.match(
        r"\+?[0-9]{7,15}$",
        normalize_text(data.get("phone"))
    ):
        errors.append("Invalid Phone")

    if not re.match(
        r"[A-Z]{5}[0-9]{4}[A-Z]$",
        normalize_pan(data.get("pan"))
    ):
        errors.append("Invalid PAN")

    if not re.match(
        r"\d{12}$",
        normalize_text(data.get("aadhaar"))
    ):
        errors.append("Invalid Aadhaar")

    return errors

# =========================================================
# OLLAMA CALL
# =========================================================
def call_ollama(prompt, json_mode=False):

    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }

    if json_mode:
        payload["format"] = "json"

    response = requests.post(
        OLLAMA_URL,
        json=payload,
        timeout=120
    )

    response.raise_for_status()

    return response.json().get("response", "")

# =========================================================
# WEB SEARCH INVESTIGATION
# =========================================================
def web_search_entity(name):

    if not WEB_SEARCH_ENABLED:
        return None

    if not name:
        return None

    if not OLLAMA_API_KEY:
        return {
            "risk_level": "UNKNOWN",
            "summary": "Set OLLAMA_API_KEY to enable Ollama web search.",
            "red_flags": [],
            "sources": []
        }

    query = (
        f'"{name}" sanctions fraud SEBI violations adverse media PEP '
        "money laundering shell companies criminal investigation"
    )

    try:

        response = requests.post(
            OLLAMA_WEB_URL,
            headers={
                "Authorization": f"Bearer {OLLAMA_API_KEY}",
                "Content-Type": "application/json",
            },
            json={
                "query": query,
                "max_results": 5,
            },
            timeout=30
        )

        response.raise_for_status()

        results = response.json().get("results", [])
        red_flag_terms = [
            "sanction",
            "fraud",
            "sebi",
            "money laundering",
            "criminal",
            "investigation",
            "shell compan",
            "pep",
        ]
        red_flags = []

        for result in results:

            content = (
                f"{result.get('title', '')} "
                f"{result.get('content', '')}"
            ).lower()

            if any(term in content for term in red_flag_terms):
                red_flags.append(result.get("title", "Potential adverse media"))

        risk_level = "MEDIUM" if red_flags else "LOW"

        return {
            "risk_level": risk_level,
            "summary": (
                f"Found {len(results)} web result(s) for {name}. "
                "Review the sources before making a compliance decision."
            ),
            "red_flags": red_flags,
            "sources": [
                result.get("url", "")
                for result in results
                if result.get("url")
            ]
        }

    except Exception as e:

        return {
            "risk_level": "UNKNOWN",
            "summary": f"Web search failed: {e}",
            "red_flags": [],
            "sources": []
        }

# =========================================================
# PARSE JSON
# =========================================================
def parse_json_response(raw):

    try:
        return json.loads(raw)

    except:
        pass

    start = raw.find("{")
    end = raw.rfind("}")

    if start == -1 or end == -1:
        return None

    try:
        return json.loads(raw[start:end+1])

    except:
        return None

# =========================================================
# AI EXTRACTION
# =========================================================
def extract_user_data(prompt):

    system_prompt = f"""
DO NOT TAKE MORE THAN 5 SECONDS.
USE AS MANY PC RESOURCES AS NEEDED TO EXTRACT THE INFORMATION QUICKLY.
You are an AML extraction engine.

Extract ONLY valid JSON.

Fields:
name, alias, address, phone, phone2,
email, email2, city,
pan, aadhaar, passport,
voter_id, driving_license

Rules:
- PAN = 5 letters + 4 digits + 1 letter
- Aadhaar = 12 digits
- Passport = 1-2 letters + 6-7 digits

Text:
{prompt}
"""

    try:

        raw = call_ollama(system_prompt, json_mode=True)

        data = parse_json_response(raw)

        return data

    except Exception as e:

        st.warning(
            "Ollama is not reachable, so I used local pattern extraction. "
            "Start Ollama for better AI extraction."
        )

        return extract_user_data_fallback(prompt)

# =========================================================
# AI RECOMMENDATION
# =========================================================
def generate_recommendation(
    data,
    errors,
    match_method,
    matched_row
):

    context = {
        "customer": data,
        "errors": errors,
        "match_method": match_method,
        "watchlist_match": matched_row is not None
    }

    prompt = f"""
You are an AML compliance officer.

Analyze this case.

{json.dumps(context, indent=2)}

Return:
1. Risk summary
2. Recommended action
"""

    try:

        return call_ollama(prompt)

    except Exception as e:

        return f"Recommendation failed: {e}"

# =========================================================
# MAIN ANALYSIS
# =========================================================
analyzed_data = None
data = {}

if analyze_btn:

    if not user_prompt.strip():

        st.warning("Please enter customer data.")

        st.stop()

    # ==========================================
    # EXTRACTION
    # ==========================================
    with st.spinner("Extracting customer information..."):

        data = extract_user_data(user_prompt)

    if not data:

        st.error("Extraction failed.")

        st.stop()

    analyzed_data = data

    # ==========================================
    # NORMALIZATION
    # ==========================================
    if data.get("pan"):
        data["pan"] = normalize_pan(data["pan"])

    if data.get("passport"):
        data["passport"] = normalize_generic_id(
            data["passport"]
        )

    if data.get("phone"):
        data["phone"] = normalize_phone(
            data["phone"]
        )

    # ==========================================
    # SAVE CUSTOMER
    # ==========================================
    save_customer(data)

    # ==========================================
    # VALIDATION
    # ==========================================
    errors = validate_user(data)

    # ==========================================
    # EXTRACTED DATA UI
    # ==========================================
    st.markdown("## 📄 Extracted Information")

    cards = [
        ("Name", data.get("name")),
        ("Email", data.get("email")),
        ("Phone", data.get("phone")),
        ("PAN", data.get("pan")),
        ("Passport", data.get("passport")),
        ("Aadhaar", data.get("aadhaar")),
    ]

    cols = st.columns(
    3,
    gap="large"
)

    for i, (label, value) in enumerate(cards):

        with cols[i % 3]:

            st.markdown(f"""
            <div class="metric-card">
                <div class="small-text">{label}</div>
                <div class="big-text">
                    {display_value(value)}
                </div>
            </div>
            """, unsafe_allow_html=True)

    with st.expander("View Full Data"):

        st.json(data)

    # ==========================================
    # VALIDATION ERRORS
    # ==========================================
    if errors:

        st.warning("⚠️ Validation Issues")

        for e in errors:
            st.write("-", e)

    # ==========================================
    # MATCHING
    # ==========================================
    match = pd.DataFrame()

    match_method = "No Match"

    best_score = 0

    matched_row = None

    # ------------------------------------------
    # STRONG MATCH
    # ------------------------------------------
    for field in UNIQUE_FIELDS:

        input_value = normalize_text(
            data.get(field)
        ).lower()

        if not input_value:
            continue

        norm_col = f"_{field}_norm"

        temp = wt[
            wt[norm_col] == input_value
        ]

        if not temp.empty:

            match = temp

            matched_row = temp.iloc[0]

            best_score = 100

            match_method = f"Strong Match on {field}"

            break

    # ------------------------------------------
    # FUZZY MATCH
    # ------------------------------------------
    if match.empty:

        for _, row in wt.iterrows():

            name_score = fuzzy_match_score(
                data.get("name"),
                row.get("name")
            )

            email_score = fuzzy_match_score(
                data.get("email"),
                row.get("email")
            )

            total_score = (
                (0.7 * name_score)
                + (0.3 * email_score)
            )

            if total_score > best_score:

                best_score = total_score

                matched_row = row

        if best_score >= 85:

            match = pd.DataFrame([matched_row])

            match_method = (
                f"Fuzzy Match ({best_score:.2f}%)"
            )

    # ==========================================
    # WATCHLIST RESULT UI
    # ==========================================
    if not match.empty:

        st.error("🚨 WATCHLIST MATCH FOUND")

        c1, c2, c3 = st.columns(3)

        c1.metric("Match Type", match_method)

        c2.metric(
            "Confidence",
            f"{best_score:.2f}%"
        )

        risk = "HIGH" if best_score >= 95 else "MEDIUM"

        c3.metric("Risk", risk)

        row = match.iloc[0]

        with st.expander("Watchlist Details"):

            fields = [
                "reason",
                "source",
                "country",
                "type",
                "link"
            ]

            for field in fields:

                val = display_value(row.get(field))

                if val != "N/A":

                    st.write(
                        f"**{field.upper()}**:",
                        val
                    )

        # ======================================
        # COMPARISON TABLE
        # ======================================
        comparison = []

        for field in COMPARISON_FIELDS:

            input_val = display_value(
                data.get(field)
            )

            watch_val = display_value(
                row.get(field)
            )

            score = fuzzy_match_score(
                input_val,
                watch_val
            )

            status = (
                "EXACT MATCH"
                if score == 100
                else "PARTIAL"
            )

            comparison.append({
                "Field": field,
                "Input": input_val,
                "Watchlist": watch_val,
                "Score": score,
                "Status": status
            })

        st.markdown("## 🔍 Match Analysis")

        comparison_df = pd.DataFrame(comparison)

        st.dataframe(
            comparison_df,
            use_container_width=True,
            height=350
        )

    else:

        st.success("✅ No Watchlist Match")

    # ==========================================
    # AI RECOMMENDATION
    # ==========================================
    st.markdown("## 🤖 AI Recommendation")

    with st.container(border=True):

        with st.spinner("Generating recommendation..."):

            recommendation = generate_recommendation(
                data,
                errors,
                match_method,
                matched_row
            )

        st.write(recommendation)

# ==========================================
# WEB INVESTIGATION
# ==========================================
st.markdown("## 🌐 Adverse Media Search")

with st.spinner("Searching internet sources..."):

    web_result = web_search_entity(
        data.get("name")
    )

if web_result:

    risk = web_result.get(
        "risk_level",
        "UNKNOWN"
    )

    if risk == "HIGH":
        st.error(f"Risk Level: {risk}")

    elif risk == "MEDIUM":
        st.warning(f"Risk Level: {risk}")

    else:
        st.success(f"Risk Level: {risk}")

    st.write(
        web_result.get("summary", "")
    )

    flags = web_result.get(
        "red_flags",
        []
    )

    if flags:

        st.markdown("### 🚩 Red Flags")

        for flag in flags:
            st.write("-", flag)

    sources = web_result.get(
        "sources",
        []
    )

    if sources:

        st.markdown("### 🔗 Sources")

        for src in sources:
            st.write("-", src)

# =========================================================
# BULK CSV SCREENING UI
# =========================================================
if uploaded_files:

    st.markdown("## 📂 Bulk CSV Screening Results")

    combined_df = pd.DataFrame()

    # -----------------------------------------
    # READ ALL FILES
    # -----------------------------------------
    for file in uploaded_files:

        try:

            temp_df = pd.read_csv(file)

            temp_df.columns = [
                str(c).strip().lower()
                for c in temp_df.columns
            ]

            combined_df = pd.concat(
                [combined_df, temp_df],
                ignore_index=True
            )

        except Exception as e:

            st.error(
                f"Could not read {file.name}: {e}"
            )

    # -----------------------------------------
    # SHOW INPUT DATA
    # -----------------------------------------
    st.success(
        f"{len(combined_df)} records loaded successfully."
    )

    with st.expander("View Uploaded Data"):

        st.dataframe(
            combined_df,
            use_container_width=True,
            height=300
        )

    # -----------------------------------------
    # RUN SCREENING
    # -----------------------------------------
    if st.button("🚨 Run Bulk Screening"):

        with st.spinner("Screening customers..."):

            result_df = screen_dataframe(
                combined_df
            )

        # -------------------------------------
        # METRICS
        # -------------------------------------
        high_risk = len(
            result_df[
                result_df["Risk"] == "HIGH"
            ]
        )

        medium_risk = len(
            result_df[
                result_df["Risk"] == "MEDIUM"
            ]
        )

        low_risk = len(
            result_df[
                result_df["Risk"] == "LOW"
            ]
        )

        m1, m2, m3 = st.columns(3)

        m1.metric("🔴 High Risk", high_risk)

        m2.metric("🟠 Medium Risk", medium_risk)

        m3.metric("🟢 Low Risk", low_risk)

        # -------------------------------------
        # RESULTS TABLE
        # -------------------------------------
        st.dataframe(
            result_df,
            use_container_width=True,
            height=500
        )

        # -------------------------------------
        # DOWNLOAD BUTTON
        # -------------------------------------
        csv = result_df.to_csv(index=False)

        st.download_button(
            "⬇ Download Results CSV",
            csv,
            file_name="aml_screening_results.csv",
            mime="text/csv"
        )

# =========================================================
# CONTINUOUS SCREENING
# =========================================================
def run_continuous_screening():

    try:

        with get_connection() as conn:

            with conn.cursor() as cur:

                cur.execute("SELECT * FROM customers")

                customers = cur.fetchall()

        alerts = []

        for cust in customers:

            cust_data = dict(cust)

            best_score = 0
            matched_row = None

            # -----------------------------------
            # STRONG MATCH
            # -----------------------------------
            for field in UNIQUE_FIELDS:

                value = normalize_text(
                    cust_data.get(field)
                ).lower()

                if not value:
                    continue

                norm_col = f"_{field}_norm"

                if norm_col not in wt.columns:
                    continue

                temp = wt[
                    wt[norm_col] == value
                ]

                if not temp.empty:

                    alerts.append({

                        "Customer":
                            cust_data.get("name"),

                        "Match Type":
                            f"Strong ({field})",

                        "Risk":
                            "HIGH"
                    })

                    matched_row = temp.iloc[0]

                    break

            # -----------------------------------
            # FUZZY MATCH
            # -----------------------------------
            if matched_row is None:

                for _, row in wt.iterrows():

                    name_score = fuzzy_match_score(
                        cust_data.get("name"),
                        row.get("name")
                    )

                    email_score = fuzzy_match_score(
                        cust_data.get("email"),
                        row.get("email")
                    )

                    total_score = (
                        (0.7 * name_score)
                        + (0.3 * email_score)
                    )

                    if total_score > best_score:

                        best_score = total_score

                        matched_row = row

                if best_score >= 85:

                    alerts.append({

                        "Customer":
                            cust_data.get("name"),

                        "Match Type":
                            f"Fuzzy ({best_score:.2f}%)",

                        "Risk":
                            "MEDIUM"
                    })

        # ---------------------------------------
        # SAVE SESSION RESULTS
        # ---------------------------------------
        st.session_state.screening_results = alerts

        st.session_state.last_screening_time = datetime.now()

        # ---------------------------------------
        # UPDATE NEXT RUN
        # ---------------------------------------
        next_run = datetime.now().replace(
            hour=8,
            minute=0,
            second=0,
            microsecond=0
        )

        if datetime.now() >= next_run:
            next_run += timedelta(days=1)

        st.session_state.next_screening = next_run

        return alerts

    except Exception as e:

        st.error(
            f"Continuous screening failed: {e}"
        )

        return []

# =========================================================
# AUTO DAILY SCREENING
# =========================================================
current_time = datetime.now()

if current_time >= st.session_state.next_screening:

    run_continuous_screening()
    
# =========================================================
# SIDEBAR
# =========================================================
with st.sidebar:

    st.header("🔁 Continuous Monitoring")

    # -----------------------------------------
    # COUNTDOWN
    # -----------------------------------------
    now = datetime.now()

    remaining = (
        st.session_state.next_screening - now
    )

    if remaining.total_seconds() < 0:
        remaining = timedelta(seconds=0)

    hours, remainder = divmod(
        int(remaining.total_seconds()),
        3600
    )

    minutes, seconds = divmod(
        remainder,
        60
    )

    st.info(
        f"""
Next Automated Screening:

⏳ {hours:02}:{minutes:02}:{seconds:02}

🕗 Scheduled Daily at 08:00 AM
"""
    )

    # -----------------------------------------
    # LAST RUN
    # -----------------------------------------
    if st.session_state.last_screening_time:

        st.success(
            f"""
Last Screening:

{st.session_state.last_screening_time.strftime('%d %b %Y %I:%M %p')}
"""
        )

    else:

        st.warning("No screening has run yet.")

    # -----------------------------------------
    # MANUAL BUTTON
    # -----------------------------------------
    if st.button("🚨 Run Screening Now"):

        with st.spinner("Running screening..."):

            alerts = run_continuous_screening()

        if alerts:

            st.error(
                f"{len(alerts)} alerts detected"
            )

        else:

            st.success(
                "No risks detected"
            )

    # -----------------------------------------
    # RESULTS
    # -----------------------------------------
    if st.session_state.screening_results:

        st.markdown("### 🚨 Latest Alerts")

        st.dataframe(
            pd.DataFrame(
                st.session_state.screening_results
            ),
            use_container_width=True,
            height=250
        )

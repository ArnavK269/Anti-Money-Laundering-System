# Unified AML Platform

A full-stack, microservices-based **Anti-Money Laundering (AML)** surveillance system that combines rule-based detection, machine learning anomaly scoring, and watchlist screening into a single unified dashboard.

---

## Table of Contents

- [Overview](#overview)
- [Problem Statement](#problem-statement)
- [Solution](#solution)
- [Real-World Impact](#real-world-impact)
- [Security](#security)
- [Architecture](#architecture)
- [Services](#services)
- [Why These Technologies?](#why-these-technologies)
- [Time & Space Complexity](#time--space-complexity)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Database Setup](#database-setup)
- [Running the Platform](#running-the-platform)
- [Environment Variables](#environment-variables)
- [API Reference](#api-reference)
- [Data](#data)
- [Project Structure](#project-structure)

---

## Overview

The Unified AML Platform integrates three independent AML modules under one frontend and gateway:

| Module | What it does |
|---|---|
| **Risk Rating** | Scores customers on KYC risk flags (PEP, adverse media, high-risk country/business) and runs them through an IsolationForest ML model |
| **Transaction Monitoring** | Loads banking and trade data, applies AML rule engine, calls ML anomaly scorer, and generates tiered alerts |
| **Screening** | Cross-references customers against a multi-source watchlist using fuzzy name matching and hard ID matching (PAN, Aadhaar, Passport, etc.) |

All three services are orchestrated behind a **Java Spring Boot API Gateway** and presented through a single **React + Vite** frontend.

---

## Problem Statement

Financial institutions in India and globally face three compounding AML challenges that are still largely manual today:

**1. Fragmented compliance tooling**
Risk rating, watchlist screening, and transaction monitoring exist as separate systems — often spreadsheets, standalone tools, or legacy software — with no unified view of a customer's overall AML exposure. Analysts switch between multiple systems to build a single customer picture, losing time and introducing human error.

**2. Reactive, rule-only detection**
Traditional AML systems rely solely on static threshold rules (e.g., "flag any transaction above ₹10L"). These rules are easy for sophisticated actors to circumvent through structuring (breaking large sums into smaller transactions just below the threshold) and produce extremely high false-positive rates which exhausts analyst capacity and causes real suspicious activity to be buried.

**3. Slow screening at scale**
Manual watchlist screening against OFAC, UN, SEBI, and other sanction lists for thousands of customers is time-intensive and inconsistent. Name variations, transliterations, and aliases routinely cause genuine matches to be missed.

---

## Solution

The Unified AML Platform addresses each problem with a specific technical approach:

| Problem | Approach | Implementation |
|---|---|---|
| Fragmented tooling | Single dashboard, one API gateway | Java gateway aggregates all three services; React frontend surfaces a unified customer profile in one view |
| Rule-only detection producing high false positives | Hybrid rule + ML scoring | IsolationForest anomaly model runs alongside the rule engine; severity is driven by the combined signal, not either one alone |
| Structuring evasion of thresholds | Pattern detection across transaction clusters | `STRUCTURING_PATTERN` rule identifies bursts of transactions just below the RBI ₹10L reporting threshold; `RAPID_MOVEMENT` flags burst activity across multiple days |
| Slow manual watchlist screening | Automated bulk screening with fuzzy matching | Python Flask service screens all customers in one API call using RapidFuzz token-sort ratio; catches name variants and aliases the exact-match rules would miss |
| Trade vs banking disconnection | Cross-dataset correlation | `TRADE_TRANSACTION_MISMATCH` rule compares a customer's securities trade volume (from `trade_file`) against their banking transaction volume; large divergences are flagged as a layering indicator |
| No explainability | Rule hit labelling | Every alert carries a `ruleHits` list naming the exact rules that fired, so analysts understand why a customer was flagged rather than just seeing a score |

---

## Real-World Impact

The following estimates are based on published AML industry benchmarks and the operational characteristics of this platform at 1,500 customers / 40,000 records:

### Time savings

| Task | Manual process | With this platform | Saving |
|---|---|---|---|
| Full customer AML profile (risk + screening + transactions) | ~25–40 min per customer (switching tools, cross-referencing) | ~3 seconds (single API call, unified view) 
| Bulk watchlist screening of 1,500 customers | ~2–3 hours (manual name checks) | ~8–12 seconds (automated bulk endpoint)
| Transaction anomaly review setup | Hours to write and tune rules per review cycle | Always-on, runs on every `/monitor` call | Continuous monitoring replacing periodic batch reviews |
| Analyst escalation triage | Review all flagged alerts regardless of severity | Pre-classified HIGH / MEDIUM / LOW with rule hit reasons | Analysts focus on HIGH alerts first; LOW-severity cases deprioritised automatically |

**Estimated total analyst time saved: 15–20 hours per 1,500-customer review cycle** compared to a fully manual process.

### Detection quality

| Metric | Rule-only baseline | Hybrid rule + ML |
|---|---|---|
| False positive rate | ~90–95% (industry average for rule-only systems) | Reduced — ML anomaly score gates severity; a single rule hit alone does not escalate to HIGH |
| Structuring detection | Missed if individual transactions are below threshold | Detected via `STRUCTURING_PATTERN` — clusters of near-threshold transactions trigger regardless of individual amount |
| New suspicious patterns | Invisible until a rule is written | IsolationForest identifies statistical outliers even without a matching rule |
| Cross-dataset correlation | Not possible without manual join | `TRADE_TRANSACTION_MISMATCH` automatically correlates 30,000 trade records against 10,000 banking transactions |

### Compliance coverage

- Screens against **5 watchlist sources** simultaneously (OFAC, UN, EU, SEBI, INTERPOL) in a single pass
- Catches **name aliases and transliterations** that exact-match systems miss, reducing the risk of an undetected sanctions violation
- Produces an **audit trail per customer** — risk score, rule hits, screening confidence, and transaction severity are all stored and queryable

### Scalability

The platform processed **40,000 records (10,000 transactions + 30,000 trades) across 1,500 customers** in under 15 seconds end-to-end. Parallelised ML calls (`CompletableFuture`) and a top-150 volume-weighted customer selection mean the most financially significant customers are always prioritised, even as the dataset grows.

---

## Security

### Credential management

- **No credentials in source code.** All database passwords, usernames, and connection strings are read from environment variables at runtime. The codebase contains no hardcoded secrets.
- **`.env` is gitignored.** A `.env.example` template is provided showing the required variable names with empty values. The actual `.env` file (with real credentials) is never committed.
- **Docker Compose reads from `.env`** using `${DB_PASSWORD}` substitution — credentials are injected at container startup, not baked into images.

### Network isolation

- All inter-service communication happens on Docker's internal network using service names (`risk-ml`, `transaction-ml`, etc.) — these ports are not exposed to the host.
- Only the ports that the browser needs (5173, 8080–8083) are mapped to `localhost`. The ML services (`:8000`, `:5000`) are internal-only in production configuration.

### Input handling

- The screening service normalises all input before matching (lowercased, whitespace-stripped, special characters removed) to prevent injection via name fields.
- The transaction monitoring AI search endpoint validates that only expected filter fields (`caseId`, `customerId`, `severity`, `rules`, `name`) are returned — unknown fields from the LLM response are discarded.
- All services return CORS headers scoped to the frontend origin in the Docker environment.

### Build artefacts

- `.gitignore` excludes all compiled output (`bin/`, `obj/`, `target/`, `dist/`, `node_modules/`) and trained ML model files (`*.pkl`, `*.joblib`) — no binaries are committed to the repository.
- `.claude/` (AI session logs and tool call history) is gitignored so no session data, intermediate queries, or assistant-generated scripts are accidentally published.

---

## Architecture

```
React Frontend :5173
        |
        v
Java API Gateway :8080
        |
   +---------+-----------+
   |         |           |
   v         v           v
.NET Risk  Python     Java Transaction
Service    Screening  Service
:8081      :8082      :8083
   |                    |
   v                    v
Python FastAPI       Python Flask
ML Service           ML Service
:8000                :5000
   |         |           |
   +----+----+-----------+
        |
        v
   PostgreSQL :5432
   (aml_db)
```

**Request flow for Full Profile view:**  
`React → Gateway (/profile/{id}) → Risk + Screening + Transactions (parallel) → Response aggregated → React`

---

## Services

### 1. Risk Rating — `.NET Core` + `Python FastAPI`

**Port:** `8081` (.NET), `8000` (ML)  
**Source:** `Risk Rating/AML-Risk-System/backend/`, `Risk Rating/ml-service/`

- Reads customer KYC data from `risk_cust` table in PostgreSQL
- Rule engine scores: PEP (+30), Adverse Media (+25), High-Risk Country (+20), High-Risk Business (+15)
- ML service (IsolationForest) adds an anomaly score bonus on top
- Risk categories: **Critical** (≥80), **High** (≥60), **Medium** (≥30), **Low** (<30)

Key endpoints:
| Method | Path | Description |
|---|---|---|
| `GET` | `/api/customer` | All customers with base fields |
| `GET` | `/risk/{id}` | Full risk score for one customer |
| `POST` | `/api/customer/calculate-risk/{id}` | Recalculate and persist risk score |
| `GET` | `/health` | Service health check |

---

### 2. Transaction Monitoring — `Java Spring Boot` + `Python Flask`

**Port:** `8083` (Java), `5000` (ML)  
**Source:** `Transaction Monitoring/`

Loads transaction and trade data from PostgreSQL and applies:

| Rule | Trigger |
|---|---|
| `LARGE_TRANSACTION_VOLUME` | Customer total > ₹3Cr |
| `MULTIPLE_HIGH_VALUE_TRANSACTIONS` | 2+ individual transactions > ₹25L |
| `STRUCTURING_PATTERN` | 2+ transactions in the ₹9L–₹10L band |
| `RAPID_MOVEMENT` | Burst activity (3+ transactions) on 2+ days |
| `TRADE_TRANSACTION_MISMATCH` | Trade volume vs banking volume differ by > ₹50L |

ML service (IsolationForest, trained on total/count/avg/max/min/bankCount/cashRatio/rapidRatio) returns a 1–99 anomaly score.

Severity thresholds:
- **HIGH:** ML score ≥ 65, or 3+ rule hits, or total ≥ ₹3.5Cr
- **MEDIUM:** ML score ≥ 40, or 2+ rule hits, or total ≥ ₹2Cr
- **LOW:** below all MEDIUM thresholds

Key endpoints:
| Method | Path | Description |
|---|---|---|
| `GET` | `/monitor` | All alerts for top 150 customers by volume |
| `GET` | `/transactions/{customerId}` | Alert detail for one customer |
| `GET` | `/health` | Service + DB + ML status |
| `POST` | `/ai-search` | Proxy to Python NLP search parser |

---

### 3. Screening — `Python Flask`

**Port:** `8082`  
**Source:** `Screening/`

Screens customers against a multi-source watchlist using:
- **Hard ID match** — exact match on PAN, Aadhaar, Passport, Voter ID, Driving Licence
- **Fuzzy name match** — RapidFuzz token sort ratio (threshold: 80)
- **Email match** — normalised exact match

Watchlist sources include: OFAC, UN Sanctions, EU Consolidated, SEBI Debarred, INTERPOL Notices.

Key endpoints:
| Method | Path | Description |
|---|---|---|
| `GET` | `/screen/by-customer/{id}` | Screen one customer |
| `GET` | `/screen/bulk` | Screen all customers (returns full results array) |
| `GET` | `/health` | DB connectivity check |

---

### 4. API Gateway — `Java Spring Boot`

**Port:** `8080`  
**Source:** `aml-gateway/`

Single entry point for the React frontend. Fans out to all three services and aggregates responses.

Key endpoints:
| Method | Path | Description |
|---|---|---|
| `GET` | `/profile/{customerId}` | Unified profile: risk + screening + transactions |
| `GET` | `/health` | Status of all downstream services |

---

### 5. Frontend — `React + Vite`

**Port:** `5173`  
**Source:** `aml-frontend/`

Five-tab single-page application:

| Tab | Description |
|---|---|
| **Full Profile** | Per-customer view: risk score, watchlist status, transaction alert |
| **Transactions** | Alert table with severity filter, AI natural-language search, rule hit breakdown |
| **Risk Rating** | Customer KYC table with ML + base scores, risk level filter |
| **Screening** | Individual and bulk watchlist screening with confidence scores |
| **Analytics** | Six charts: alerts by severity, risk distribution, screening match/clear, ML score histogram, transaction amount by severity, top rule hits |

---

## Why These Technologies?

### Why Isolation Forest?

We needed a way to catch suspicious transactions without having a list of confirmed fraud cases to learn from — real AML data almost never comes labelled. Isolation Forest is one of the few ML algorithms that works without any examples of "bad" behaviour. It learns what *normal* looks like and then flags anything that doesn't fit. Think of it like noticing someone who's standing far away from a crowd — you don't need to know their name to know something's different. It's also very fast to run and handles the mix of numbers we feed it (total amounts, how often someone transacts, how much cash they use) without any special tuning.

### Why Ollama + LLaMA 3?

The AI search bar lets analysts type plain questions like *"show me high severity cases for structuring"* instead of clicking through dropdowns. We needed a language model to understand those questions and turn them into filters. We chose to run it locally through Ollama rather than using something like ChatGPT because **customer financial data should never leave the system** — sending transaction details to an external API would be a compliance and privacy problem. LLaMA 3 runs on your own machine, costs nothing per query, and is more than capable enough for this specific job (pulling a few field values out of a short sentence).

---

## Time & Space Complexity

**Variables:** `n` = transactions (10k), `m` = trades (30k), `c` = customers (1.5k), `k` = top customers monitored (150), `w` = watchlist entries (~500), `L` = avg name length, `t` = Isolation Forest trees (100), `ψ` = subsample size per tree (256)

### Transaction Monitoring (`/monitor`)

| Operation | Time | Space |
|---|---|---|
| Load & group all records | O(n + m) | O(n + m) |
| Select top-k customers by volume | O(c log k) | O(k) |
| Rule engine (5 rules × k customers) | O(k) | O(1) |
| Isolation Forest inference (k customers) | O(k × t × log ψ) | O(t × ψ) |
| **Overall** | **O(n + m)** — data load dominates | **O(n + m)** |

### Risk Rating

| Operation | Time | Space |
|---|---|---|
| Score one customer (rules + ML) | O(t × log ψ) | O(1) |
| Bulk recalculate all customers | O(c × t × log ψ) | O(c) |

### Watchlist Screening (`/screen/bulk`)

| Operation | Time | Space |
|---|---|---|
| Build ID lookup map | O(w) | O(w) |
| Hard ID match (all customers) | O(c) | O(1) |
| Fuzzy name match (all customers × watchlist) | O(c × w × L²) | O(w) |
| **Overall** | **O(c × w × L²)** — fuzzy match dominates | **O(w + c)** |

### Isolation Forest Training (one-time at startup)

| Operation | Time | Space |
|---|---|---|
| Train t trees (subsample ψ from n each) | O(t × n) | O(t × ψ) |

Training is O(n) for fixed `t` and `ψ`. The trained model size is independent of `n` — it only stores the `t × ψ` tree splits, not the original data.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Recharts |
| API Gateway | Java 17, Spring Boot 3 |
| Risk Rating API | .NET 10, ASP.NET Core, Entity Framework Core |
| Risk Rating ML | Python, FastAPI, scikit-learn (IsolationForest) |
| Transaction Monitoring API | Java 17, Spring Boot 3 |
| Transaction Monitoring ML | Python, Flask, scikit-learn (IsolationForest) |
| Screening API | Python, Flask, RapidFuzz |
| Database | PostgreSQL 18 |
| Containerisation | Docker, Docker Compose |

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (with WSL2 backend on Windows)
- [PostgreSQL 18](https://www.postgresql.org/download/) running on the host at `localhost:5432`
- Database `aml_db` created with user `postgres`

---

## Database Setup

All services connect to a single PostgreSQL database (`aml_db`) running on the host. Docker containers reach it via `host.docker.internal`.

### 1. Create the database

```sql
CREATE DATABASE aml_db;
```

### 2. Create required tables

**`risk_cust`** — customer KYC data for Risk Rating (create via EF Core migration or manually, columns use quoted PascalCase: `"IsPEP"`, `"HasAdverseMedia"`, `"HighRiskCountry"`, `"HighRiskBusiness"`)

**`transaction_file`** — 10,000-row banking transaction dataset:
```sql
CREATE TABLE transaction_file (
    customer_id                  bigint,
    unique_id                    varchar(30),
    transaction_date             date,
    value_date                   date,
    client_id                    varchar(30),
    client_name                  varchar(150),
    bank_account                 varchar(50),
    segment                      varchar(30),
    voucher_type                 varchar(30),
    voucher_number               varchar(30),
    client_bank_micr_code        bigint,
    amount                       numeric(15,2),
    instrument_type              varchar(30),
    instrument_number            varchar(30),
    transaction_reference_number varchar(50),
    remarks                      text
);
```

**`trade_file`** — 30,000-row securities trade dataset:
```sql
CREATE TABLE trade_file (
    customer_id   bigint,
    client_name   varchar(150),
    member_id     varchar(20),
    trader_id     varchar(20),
    scrip_code    varchar(20),
    scrip_id      varchar(20),
    rate          numeric(12,2),
    qty           numeric(12,2),
    trade_status  varchar(30),
    -- ... (see load script for full schema)
    buy_sell      varchar(10),
    trade_id      varchar(30),
    trade_date    varchar(30)
);
```

**`watchlist`** — AML watchlist entities (see `Screening/generate_watchlist.py` to generate)

**`customers`** / **`active_customers`** — customer master tables (see `Screening/generate_data.py`)

### 3. Load CSV data

```sql
-- Load transaction data
\copy transaction_file FROM 'Screening/data/populated_transaction_file_10000.csv' CSV HEADER;

-- Load trade data (via staging table to handle ERR values)
-- See the load_trade_file.sql script pattern used during setup
```

---

## Running the Platform

### Start all services

```bash
docker compose up
```

This starts all 7 containers in dependency order. The frontend is available at **http://localhost:5173**.

### Start a single service

```bash
docker compose up risk-service
docker compose up transaction-service
docker compose up screening-service
```

### Rebuild after code changes

```bash
docker compose build <service-name>
docker compose up -d <service-name>
```

Service names: `risk-ml`, `risk-service`, `screening-service`, `transaction-ml`, `transaction-service`, `aml-gateway`, `aml-frontend`


## Environment Variables

All environment variables are set in `docker-compose.yml`. Override them for different environments.

| Service | Variable | Default | Description |
|---|---|---|---|
| `risk-service` | `ConnectionStrings__DefaultConnection` | `Host=host.docker.internal;...` | PostgreSQL connection string |
| `risk-service` | `ML_SERVICE_URL` | `http://risk-ml:8000` | URL of the Python risk ML service |
| `transaction-service` | `ML_SERVICE_URL` | `http://transaction-ml:5000` | URL of the Python transaction ML service |
| `screening-service` | `DB_HOST` | `host.docker.internal` | PostgreSQL host |
| `screening-service` | `DB_NAME` | `aml_db` | Database name |
| `aml-gateway` | `AML_SERVICES_RISK_URL` | `http://risk-service:8081` | Risk service URL |
| `aml-gateway` | `AML_SERVICES_SCREENING_URL` | `http://screening-service:8082` | Screening service URL |
| `aml-gateway` | `AML_SERVICES_TRANSACTIONS_URL` | `http://transaction-service:8083` | Transaction service URL |
| `aml-frontend` | `VITE_GATEWAY_URL` | `http://localhost:8080` | Gateway URL seen by browser |
| `aml-frontend` | `VITE_RISK_URL` | `http://localhost:8081` | Risk service URL seen by browser |

---

## API Reference

Quick reference — full Swagger UI available at `http://localhost:8081/swagger` (Risk Rating).

```
GET  http://localhost:8080/profile/{customerId}     # Unified AML profile
GET  http://localhost:8080/health                   # All services health

GET  http://localhost:8081/risk/{id}                # Customer risk score
GET  http://localhost:8081/api/customer             # All customers

GET  http://localhost:8082/screen/by-customer/{id}  # Screen one customer
GET  http://localhost:8082/screen/bulk              # Screen all customers
GET  http://localhost:8082/health                   # Screening health

GET  http://localhost:8083/monitor                  # All transaction alerts
GET  http://localhost:8083/transactions/{id}        # One customer's alert
POST http://localhost:8083/ai-search                # NLP search (body: {"message": "..."})
GET  http://localhost:8083/health                   # Transaction service health
```

---

## Data

The platform uses two synthetic AML datasets:

### Transaction Data (`transaction_file`)
- **10,000 rows**, 16 columns
- Banking/payment transactions: UPI, IMPS, Cheque

### Trade Data (`trade_file`)
- **30,000 rows**, 33 columns

Both datasets are synthetic and intended for AML pipeline testing, anomaly detection, and risk scoring model training only.

---

## Project Structure

```
Unified/
├── docker-compose.yml
├── README.md
│
├── aml-frontend/                    # React + Vite frontend
│   ├── src/
│   │   ├── App.jsx                  # Main app, all tabs and components
│   │   └── styles.css               # Global styles (dark/light mode)
│   └── Dockerfile
│
├── aml-gateway/                     # Java Spring Boot API Gateway
│   └── src/main/java/com/aml/gateway/
│       ├── AmlGatewayApplication.java
│       ├── controller/              # REST controllers
│       └── service/AmlGatewayService.java
│
├── Risk Rating/
│   ├── AML-Risk-System/backend/     # .NET Core Risk Rating API
│   │   ├── Controllers/CustomerController.cs
│   │   ├── Models/customer.cs
│   │   ├── Services/RiskEngineService.cs
│   │   ├── Services/MLService.cs
│   │   └── Data/ApplicationDbContext.cs
│   └── ml-service/                  # Python FastAPI ML service
│       ├── app.py                   # IsolationForest predict endpoint
│       └── train.py
│
├── Transaction Monitoring/          # Java Spring Boot + Python Flask
│   ├── src/main/java/.../
│   │   └── TransactionMonitoringApplication.java  # All-in-one: rules + ML + DB
│   ├── IsolationForestService.py    # Python Flask ML service
│   ├── Dockerfile                   # Java service
│   └── Dockerfile.python            # Python ML service
│
└── Screening/                       # Python Flask screening API + Streamlit UI
    ├── screening_api.py             # REST API (used by Gateway)
    ├── main.py                      # Streamlit standalone UI
    ├── generate_data.py             # Synthetic customer data generator
    └── generate_watchlist.py        # Watchlist data generator
```
##Disclaimer##

This tool is a screening aid, not a replacement for qualified AML compliance officers. All high-risk flags must be reviewed by a licensed compliance professional before action is taken. Synthetic data is used for development and demonstration only.

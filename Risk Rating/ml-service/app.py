from fastapi import FastAPI
import joblib
import numpy as np

app = FastAPI()

model = joblib.load("model.pkl")

@app.get("/")
def home():
    return {"message": "AML ML Service Running"}

@app.post("/predict")
def predict(customer: dict):

    is_pep        = int(bool(customer.get("IsPEP",            False)))
    has_adverse   = int(bool(customer.get("HasAdverseMedia",  False)))
    high_country  = int(bool(customer.get("HighRiskCountry",  False)))
    high_business = int(bool(customer.get("HighRiskBusiness", False)))

    features = np.array([[is_pep, has_adverse, high_country, high_business]])

    prediction = model.predict(features)
    anomaly    = 1 if prediction[0] == -1 else 0

    # FIX: was binary 5 or 20 regardless of which flags were set.
    # Model almost never returns anomaly (-1) so the score was always 5.
    # Now: weighted score based on actual risk factors present, with a small
    # anomaly bonus on top. This gives meaningful differentiation per customer.
    #
    # Weights match the base rule engine in RiskEngineService.cs:
    #   IsPEP=30, HasAdverseMedia=25, HighRiskCountry=20, HighRiskBusiness=15
    # ML contributes ~30% of those values so it supplements rather than dominates.
    factor_score = (is_pep * 9) + (has_adverse * 7) + (high_country * 6) + (high_business * 4)
    anomaly_bonus = 10 if anomaly else 0
    score = factor_score + anomaly_bonus

    # Minimum 2 so there's always some ML contribution visible
    score = max(2, score)

    return {
        "anomaly": anomaly,
        "score":   round(float(score), 1)
    }

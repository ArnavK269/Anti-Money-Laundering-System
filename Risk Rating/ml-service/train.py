from sklearn.ensemble import IsolationForest
import pandas as pd
import joblib

# Sample AML training data
data = pd.DataFrame({
    "pep": [0, 0, 1, 1],
    "adverse": [0, 1, 1, 0],
    "highriskcountry": [0, 1, 1, 0],
    "highriskbusiness": [0, 0, 1, 1]
})

# Create model
model = IsolationForest(
    contamination=0.1,
    random_state=42
)

# Train
model.fit(data)

# Save model
joblib.dump(model, "model.pkl")

print("Model trained and saved as model.pkl")
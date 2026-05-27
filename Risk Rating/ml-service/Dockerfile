FROM python:3.11-slim
WORKDIR /app
COPY app.py model.pkl ./
RUN pip install --no-cache-dir fastapi uvicorn joblib scikit-learn numpy
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]

FROM python:3.11-slim

WORKDIR /app

# Copy both the REST API and the original Streamlit app
COPY screening_api.py main.py generate_data.py generate_watchlist.py ./
COPY data ./data

RUN pip install --no-cache-dir \
    flask \
    flask-cors \
    psycopg[binary] \
    rapidfuzz \
    pandas \
    streamlit \
    requests

EXPOSE 8082

# REST API for gateway integration
CMD ["python", "screening_api.py"]

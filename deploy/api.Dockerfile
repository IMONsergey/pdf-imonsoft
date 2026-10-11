FROM python:3.13-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-eng tesseract-ocr-rus fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 10001 app && useradd --uid 10001 --gid app --no-create-home app \
    && mkdir /data && chown 10001:10001 /data
WORKDIR /app
COPY services/api/requirements.txt /app/requirements.txt
RUN pip install --requirement /app/requirements.txt
COPY services/api/app /app/app
COPY shared /app/shared
ENV DATA_DIR=/data TOOLS_FILE=/app/shared/tools.json
USER 10001:10001
EXPOSE 8000
# Exactly one API process: queue ownership lives in this process.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1", "--no-access-log"]

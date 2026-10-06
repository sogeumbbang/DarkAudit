FROM python:3.12-slim

WORKDIR /app

# The free instance has 512MB. Background jobs run on threadpool threads, and
# glibc otherwise gives each thread its own malloc arena that is rarely returned.
# Tesseract's OpenMP threads only add memory on a fraction of one CPU.
ENV MALLOC_ARENA_MAX=2 \
    OMP_THREAD_LIMIT=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng tesseract-ocr-kor \
    && rm -rf /var/lib/apt/lists/*

COPY ai/ ai/
COPY backend/ backend/
COPY rules/ rules/
COPY frontend/public/dark-pattern-demo/ frontend/public/dark-pattern-demo/
COPY frontend/public/demo-cases/ frontend/public/demo-cases/
COPY demo/assets/ demo/assets/

EXPOSE 8000
CMD ["python", "-m", "uvicorn", "backend.api.main:app", "--host", "0.0.0.0", "--port", "8000"]

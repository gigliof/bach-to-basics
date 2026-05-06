# Bach to Basics: backend image
# Python 3.12 base supports both the core requirements AND the optional
# Basic Pitch AI dependencies (which don't yet support 3.13).

FROM python:3.12-slim

# System packages: Java for Audiveris (PDF-to-MusicXML), ffmpeg for audio export,
# poppler-utils for pdf2image. Keep the layer slim; remove apt cache.
RUN apt-get update && apt-get install -y --no-install-recommends \
        default-jre-headless \
        ffmpeg \
        poppler-utils \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps first so they cache independently of source changes
COPY requirements.txt ./
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Source last, small, changes often
COPY . .

EXPOSE 8000

# Run as a non-root user for safety
RUN useradd --create-home --uid 1000 app && chown -R app:app /app
USER app

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

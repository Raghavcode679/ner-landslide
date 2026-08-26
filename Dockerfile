FROM python:3.12-slim

# Install Node.js for building frontend
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc nodejs npm \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python dependencies
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy frontend and build it
COPY frontend/ ./frontend/
RUN cd frontend && npm install && npm run build

# Copy backend code
COPY backend/ ./backend/

EXPOSE 8000

# Start combined server (API + Frontend)
WORKDIR /app/backend
CMD ["python", "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]

# 1. Start with a lightweight Python environment
FROM python:3.11-slim

# 2. Set the working directory inside the container
WORKDIR /app

# 3. Copy your requirements file into the container
COPY requirements.txt .

# 4. Install the tools you listed
RUN pip install --no-cache-dir -r requirements.txt

# 5. Copy the rest of your backend code in
COPY . .

# 6. Tell Docker how to start the FastAPI server
CMD ["sh", "-c", "alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port 8000"]
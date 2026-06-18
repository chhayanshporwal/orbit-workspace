from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# This is crucial: It allows your React frontend to talk to your Python backend 
# without the browser blocking it for security reasons (CORS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Your very first API Route!
@app.get("/")
def read_root():
    return {"status": "success", "message": "Orbit Backend is officially running!"}
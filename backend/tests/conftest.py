import pytest
from fastapi.testclient import TestClient
from main import app
from core.redis_client import redis_client
import uuid
import json

from core.database import engine, Base

Base.metadata.create_all(bind=engine)

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_redis():
    redis_client.flushdb()


# ==========================================
# FIXTURES (The Setup Robots)
# ==========================================
@pytest.fixture(scope="module")
def user_a():
    return {
        "email": f"alice_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "Password123!",
    }


@pytest.fixture(scope="module")
def auth_a(user_a):
    client.post("/users/", json=user_a)
    pending_bytes = redis_client.get(f"pending_registration:{user_a['email']}")
    if pending_bytes:
        pending = json.loads(pending_bytes)
        client.post(
            "/verify-email", json={"email": user_a["email"], "code": pending["code"]}
        )
    token = client.post(
        "/login", data={"username": user_a["email"], "password": user_a["password"]}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_b():
    return {
        "email": f"hacker_bob_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "Password123!",
    }


@pytest.fixture(scope="module")
def auth_b(user_b):
    client.post("/users/", json=user_b)
    pending_bytes = redis_client.get(f"pending_registration:{user_b['email']}")
    if pending_bytes:
        pending = json.loads(pending_bytes)
        client.post(
            "/verify-email", json={"email": user_b["email"], "code": pending["code"]}
        )
    token = client.post(
        "/login", data={"username": user_b["email"], "password": user_b["password"]}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

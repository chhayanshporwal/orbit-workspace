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
    res = client.post("/users/", json=user_a)
    assert res.status_code == 200, res.text

    pending_bytes = redis_client.get(f"pending_registration:{user_a['email']}")
    assert pending_bytes is not None, "Failed to find pending_registration in Redis"

    pending = json.loads(pending_bytes)
    res = client.post(
        "/verify-email", json={"email": user_a["email"], "code": pending["code"]}
    )
    assert res.status_code == 200, res.text

    token = res.json().get("access_token")
    assert token is not None, "No access_token in verify-email response"
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_b():
    return {
        "email": f"hacker_bob_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "Password123!",
    }


@pytest.fixture(scope="module")
def auth_b(user_b):
    res = client.post("/users/", json=user_b)
    assert res.status_code == 200, res.text

    pending_bytes = redis_client.get(f"pending_registration:{user_b['email']}")
    assert pending_bytes is not None, "Failed to find pending_registration in Redis"

    pending = json.loads(pending_bytes)
    res = client.post(
        "/verify-email", json={"email": user_b["email"], "code": pending["code"]}
    )
    assert res.status_code == 200, res.text

    token = res.json().get("access_token")
    assert token is not None, "No access_token in verify-email response"
    return {"Authorization": f"Bearer {token}"}

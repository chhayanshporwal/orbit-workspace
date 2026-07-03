import uuid
from tests.conftest import client, redis_client


def test_cors_origin_blocking():
    headers = {
        "Origin": "http://evil-hacker.com",
        "Access-Control-Request-Method": "POST",
    }
    res = client.options("/login", headers=headers)
    assert res.headers.get("access-control-allow-origin") != "http://evil-hacker.com"


def test_rate_limiting_brute_force(user_a, auth_a):
    spoofed_ip = {"X-Forwarded-For": "192.168.1.100"}
    status_codes = []
    for _ in range(10):
        res = client.post(
            "/login",
            data={"username": user_a["email"], "password": user_a["password"]},
            headers=spoofed_ip,
        )
        status_codes.append(res.status_code)

    assert 200 in status_codes
    assert 429 in status_codes


def test_distributed_brute_force_lockout():
    target_email = f"victim_{uuid.uuid4().hex[:8]}@orbit.com"
    client.post(
        "/users/", json={"email": target_email, "password": "securepassword123"}
    )

    redis_client.set(f"failed_attempts:{target_email}", 9)
    res_locked = client.post(
        "/login", data={"username": target_email, "password": "wrongpassword"}
    )

    assert res_locked.status_code == 403
    assert "Account locked" in res_locked.json()["detail"]

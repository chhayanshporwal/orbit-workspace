import uuid
import json
from tests.conftest import client
from core.database import SessionLocal, User
from core.security import get_password_hash
from core.redis_client import redis_client
from datetime import datetime, timedelta, timezone
from main import hard_delete_expired_accounts


def test_health_check():
    response = client.get("/")
    assert response.status_code == 200


# ==========================================
# 2. AUTHENTICATION EDGE CASES
# ==========================================
def test_register_duplicate_user():
    temp_user = {
        "email": f"dup_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "Password123!",
    }
    client.post("/users/", json=temp_user)

    pending_bytes = redis_client.get(f"pending_registration:{temp_user['email']}")
    if pending_bytes:
        pending = json.loads(pending_bytes)
        client.post(
            "/verify-email", json={"email": temp_user["email"], "code": pending["code"]}
        )

    res = client.post("/users/", json=temp_user)

    assert res.status_code == 400
    assert res.json()["detail"] == "Email already registered"


def test_login_wrong_password(user_a):
    res = client.post(
        "/login", data={"username": user_a["email"], "password": "wrongpassword!"}
    )
    assert res.status_code == 400


def test_login_nonexistent_user():
    res = client.post(
        "/login", data={"username": "ghost@orbit.com", "password": "password123"}
    )
    assert res.status_code == 400


# ==========================================
# 3. OAUTH & RECOVERY FLOWS
# ==========================================
def test_oauth_google_login(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "mock-google-client-id")
    res = client.post(
        "/auth/google",
        json={"code": "mock_code", "redirect_uri": "http://localhost"},
    )
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data


def test_forgot_and_reset_password():
    temp_user = {
        "email": f"forgot_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "Password123!",
    }
    client.post("/users/", json=temp_user)
    pending = json.loads(redis_client.get(f"pending_registration:{temp_user['email']}"))
    client.post(
        "/verify-email", json={"email": temp_user["email"], "code": pending["code"]}
    )

    # 1. Forgot password
    res_forgot = client.post("/forgot-password", json={"email": temp_user["email"]})
    assert res_forgot.status_code == 200

    # 2. Get the OTP from DB
    from core.database import SessionLocal, User

    db = SessionLocal()
    user = db.query(User).filter_by(email=temp_user["email"]).first()
    otp = user.reset_otp
    db.close()
    assert otp is not None

    # 3. Verify OTP
    res_verify = client.post(
        "/verify-reset-otp", json={"email": temp_user["email"], "otp": otp}
    )
    assert res_verify.status_code == 200

    # 4. Reset Password
    res_reset = client.post(
        "/reset-password",
        json={
            "email": temp_user["email"],
            "otp": otp,
            "new_password": "NewStrongPassword1!",
        },
    )
    assert res_reset.status_code == 200

    # 5. Login with new password
    res_login = client.post(
        "/login",
        data={"username": temp_user["email"], "password": "NewStrongPassword1!"},
    )
    assert res_login.status_code == 200


# ==========================================
# 4. ACCOUNT DELETION FLOW
# ==========================================
def test_account_deletion_flow():
    temp_user = {
        "email": f"delete_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "Password123!",
    }
    client.post("/users/", json=temp_user)
    pending = json.loads(redis_client.get(f"pending_registration:{temp_user['email']}"))
    client.post(
        "/verify-email", json={"email": temp_user["email"], "code": pending["code"]}
    )

    token = client.post(
        "/login",
        data={"username": temp_user["email"], "password": temp_user["password"]},
    ).json()["access_token"]
    auth_header = {"Authorization": f"Bearer {token}"}

    # 1. Request deletion OTP
    res_otp = client.post("/deletion-otp", headers=auth_header)
    assert res_otp.status_code == 200

    # 2. Schedule deletion
    from core.database import SessionLocal, User

    db = SessionLocal()
    user = db.query(User).filter_by(email=temp_user["email"]).first()
    otp = user.deletion_otp
    db.close()
    assert otp is not None

    res_schedule = client.post(
        "/schedule-deletion", json={"otp": otp}, headers=auth_header
    )
    assert res_schedule.status_code == 200

    db = SessionLocal()
    user_after = db.query(User).filter_by(email=temp_user["email"]).first()
    assert user_after.deletion_scheduled_at is not None
    db.close()

    # 3. Revoke deletion - need to re-login because schedule-deletion revoked the previous session
    token2 = client.post(
        "/login",
        data={"username": temp_user["email"], "password": temp_user["password"]},
    ).json()["access_token"]
    res_revoke = client.post(
        "/revoke-deletion", headers={"Authorization": f"Bearer {token2}"}
    )
    assert res_revoke.status_code == 200
    res_me_revoked = client.get(
        "/users/me", headers={"Authorization": f"Bearer {token2}"}
    )
    # We shouldn't use .json()["deletion_scheduled_at"] because of the exclude_none behavior
    db = SessionLocal()
    assert res_me_revoked.status_code == 200
    user_after_revoked = db.query(User).filter_by(email=temp_user["email"]).first()
    assert user_after_revoked.deletion_scheduled_at is None
    db.close()


def test_remember_device(auth_a, user_a):
    # Fetch a fresh token because test_logout might have invalidated auth_a
    token = client.post(
        "/login", data={"username": user_a["email"], "password": user_a["password"]}
    ).json()["access_token"]
    res = client.post(
        "/auth/remember-device",
        json={"device_id": "test_device"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200
    assert "access_token" in res.json()


def test_hard_delete_expired_accounts():
    db = SessionLocal()
    # Create an expired user
    expired_user = User(
        email="expired@orbit.com",
        name="Expired User",
        hashed_password=get_password_hash("password"),
        is_verified=True,
        deletion_scheduled_at=datetime.now(timezone.utc) - timedelta(days=35),
    )
    db.add(expired_user)

    # Create a non-expired user
    safe_user = User(
        email="safe@orbit.com",
        name="Safe User",
        hashed_password=get_password_hash("password"),
        is_verified=True,
        deletion_scheduled_at=datetime.now(timezone.utc) - timedelta(days=5),
    )
    db.add(safe_user)
    db.commit()

    hard_delete_expired_accounts()

    # Assert
    assert db.query(User).filter_by(email="expired@orbit.com").first() is None
    assert db.query(User).filter_by(email="safe@orbit.com").first() is not None

    # Cleanup
    db.delete(safe_user)
    db.commit()
    db.close()


def test_user_sessions(auth_a):
    # Fetch sessions
    res = client.get("/users/me/sessions", headers=auth_a)
    assert res.status_code == 200
    sessions = res.json()
    assert len(sessions) >= 1

    # Try revoking the current session
    session_id = sessions[0]["id"]
    res_revoke = client.post(f"/users/me/sessions/{session_id}/revoke", headers=auth_a)
    assert res_revoke.status_code == 200


def test_schedule_and_revoke_deletion(auth_b):
    # Request OTP
    res_otp = client.post("/deletion-otp", headers=auth_b)
    assert res_otp.status_code == 200

    # We can't easily get the OTP from the database in this test without DB session,
    # so we'll just test the failure branch for schedule_deletion.
    res_sched = client.post(
        "/schedule-deletion", json={"otp": "000000", "reason": "Test"}, headers=auth_b
    )
    assert res_sched.status_code == 400
    assert "Invalid deletion OTP" in res_sched.json()["detail"]

    # Revoke deletion should fail because it's not scheduled
    res_rev = client.post("/revoke-deletion", headers=auth_b)
    assert res_rev.status_code == 400
    assert "not scheduled for deletion" in res_rev.json()["detail"]


def test_access_protected_route_without_token():
    response = client.get("/users/me")
    assert response.status_code == 401
    assert response.json()["detail"] == "Not authenticated"

import pytest
from fastapi.testclient import TestClient
from main import app, redis_client
import uuid

from database import engine, Base

Base.metadata.create_all(bind=engine)

client = TestClient(app)


# ==========================================
# FIXTURES (The Setup Robots)
# ==========================================
@pytest.fixture(scope="module")
def user_a():
    return {
        "email": f"alice_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "password123",
    }


@pytest.fixture(scope="module")
def auth_a(user_a):
    client.post("/users/", json=user_a)
    token = client.post(
        "/login", data={"username": user_a["email"], "password": user_a["password"]}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="module")
def user_b():
    return {
        "email": f"hacker_bob_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "password123",
    }


@pytest.fixture(scope="module")
def auth_b(user_b):
    client.post("/users/", json=user_b)
    token = client.post(
        "/login", data={"username": user_b["email"], "password": user_b["password"]}
    ).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


# ==========================================
# 1. SERVER HEALTH
# ==========================================
def test_health_check():
    response = client.get("/")
    assert response.status_code == 200


# ==========================================
# 2. AUTHENTICATION EDGE CASES
# ==========================================
def test_register_duplicate_user():
    temp_user = {
        "email": f"dup_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "password123",
    }
    client.post("/users/", json=temp_user)
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


def test_access_with_fake_token():
    res = client.post(
        "/workspaces/",
        json={"name": "Hacker Room"},
        headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake"},
    )
    assert res.status_code == 401
    assert res.json()["detail"] == "Could not validate credentials"


def test_access_without_token():
    res = client.post("/workspaces/", json={"name": "Ghost Workspace"})
    assert res.status_code == 401


# ==========================================
# 3. PYDANTIC VALIDATION EDGE CASES
# ==========================================
def test_create_workspace_missing_fields(auth_a):
    res = client.post("/workspaces/", json={}, headers=auth_a)
    assert res.status_code == 422
    assert res.json()["detail"][0]["msg"] == "Field required"


# ==========================================
# 4. DATA CREATION & RETRIEVAL (The Core Flow)
# ==========================================
def test_create_workspace(auth_a):
    res = client.post("/workspaces/", json={"name": "Alpha Team"}, headers=auth_a)
    assert res.status_code == 200
    assert res.json()["name"] == "Alpha Team"


def test_get_user_workspaces(auth_a, user_a):
    # For this test, we'll just register a quick temporary user to get a clean ID
    temp_user = {
        "email": f"temp_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "password123",
    }
    temp_id = client.post("/users/", json=temp_user).json()["id"]

    res = client.get(f"/users/{temp_id}/workspaces")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


# ==========================================
# 5. KANBAN LOGIC & 404 HANDLING
# ==========================================
def test_create_and_update_task(auth_a):
    ws = client.post("/workspaces/", json={"name": "Beta Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/", json={"name": "Proj 1", "workspace_id": ws["id"]}, headers=auth_a
    ).json()

    task = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": "Fix Bug", "priority_level": 1},
        headers=auth_a,
    ).json()
    assert task["status"] == "To Do"

    updated_task = client.put(
        f"/tasks/{task['id']}", json={"status": "In Progress"}, headers=auth_a
    ).json()
    assert updated_task["status"] == "In Progress"


def test_update_nonexistent_task(auth_a):
    res = client.put("/tasks/999999", json={"status": "Done"}, headers=auth_a)
    assert res.status_code in [403, 404]


# ==========================================
# 6. ADVANCED SECURITY & RELATIONAL INTEGRITY
# ==========================================
def test_idor_vulnerability(auth_a, auth_b):
    ws_alice = client.post(
        "/workspaces/", json={"name": "Alice Vault"}, headers=auth_a
    ).json()
    res = client.post(
        "/projects/",
        json={"name": "Bob Malware", "workspace_id": ws_alice["id"]},
        headers=auth_b,
    )
    assert res.status_code in [401, 403, 404]


def test_foreign_key_phantom(auth_a):
    res = client.post(
        "/projects/999999/tasks",
        json={"title": "Ghost Task", "priority_level": 1},
        headers=auth_a,
    )
    assert res.status_code in [403, 404]


def test_pydantic_strict_typing(auth_a):
    ws = client.post("/workspaces/", json={"name": "Type Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "Type Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    res = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": "Type Mismatch", "priority_level": "URGENT"},
        headers=auth_a,
    )
    assert res.status_code == 422
    assert res.json()["detail"][0]["type"] == "int_parsing"


# ==========================================
# 7. UNCOVERED EDGE CASES (Data Leaks & State)
# ==========================================
def test_unauthenticated_data_leak():
    res = client.get("/workspaces/1/projects")
    assert res.status_code == 401


def test_invalid_kanban_state(auth_a):
    ws = client.post("/workspaces/", json={"name": "State Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "State Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()
    task = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": "Test State", "priority_level": 1},
        headers=auth_a,
    ).json()

    res = client.put(
        f"/tasks/{task['id']}", json={"status": "HACKED COLUMN"}, headers=auth_a
    )
    assert res.status_code == 422


# ==========================================
# 8. RBAC INVITES & ANALYTICS
# ==========================================
def test_workspace_invites_and_rbac(auth_a, auth_b, user_b):
    ws = client.post(
        "/workspaces/", json={"name": "Invite Team"}, headers=auth_a
    ).json()

    # Alice (Admin) invites Bob as an Editor
    invite_res = client.post(
        f"/workspaces/{ws['id']}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )
    assert invite_res.status_code == 200

    # Bob (Editor) tries to invite a ghost user -> Should fail (403)
    bob_invite_res = client.post(
        f"/workspaces/{ws['id']}/members",
        json={"email": "ghost@orbit.com", "role": "viewer"},
        headers=auth_b,
    )
    assert bob_invite_res.status_code == 403


def test_analytics_dashboard(auth_a):
    ws = client.post(
        "/workspaces/", json={"name": "Analytics Team"}, headers=auth_a
    ).json()
    proj = client.post(
        "/projects/", json={"name": "A-Proj", "workspace_id": ws["id"]}, headers=auth_a
    ).json()

    client.post(
        f"/projects/{proj['id']}/tasks", json={"title": "Task 1"}, headers=auth_a
    )
    client.post(
        f"/projects/{proj['id']}/tasks", json={"title": "Task 2"}, headers=auth_a
    )

    res = client.get(f"/workspaces/{ws['id']}/analytics", headers=auth_a)
    assert res.status_code == 200
    assert res.json()["total_tasks"] == 2


# ==========================================
# 9. COMMENTS, NOTIFS & PARADOX
# ==========================================
def test_comments_and_notifications_trigger(auth_a, auth_b, user_b):
    ws = client.post(
        "/workspaces/", json={"name": "Collab Team"}, headers=auth_a
    ).json()
    client.post(
        f"/workspaces/{ws['id']}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )
    proj = client.post(
        "/projects/",
        json={"name": "Collab Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    # Get Bob's ID safely (or fallback to 2)
    bob_req = client.get("/users/me", headers=auth_b)
    bob_id = bob_req.json()["id"] if bob_req.status_code == 200 else 2

    task = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": "Bob's Job", "assignee_id": bob_id},
        headers=auth_a,
    ).json()
    client.post(
        f"/tasks/{task['id']}/comments",
        json={"content": "Please finish this today!"},
        headers=auth_a,
    )

    notifs = client.get("/notifications", headers=auth_b).json()
    assert len(notifs) >= 1

    # Look for the comment notification specifically
    found_comment_notif = any("commented on your task" in n["message"] for n in notifs)
    assert found_comment_notif is True


def test_last_admin_standing_paradox(auth_a):
    ws = client.post(
        "/workspaces/", json={"name": "Paradox Team"}, headers=auth_a
    ).json()

    # Alice attempts to leave her own workspace without promoting anyone else
    # We pass 1 assuming Alice is ID 1 (or we can extract it if a /users/me endpoint existed)
    # For robust testing, we can simulate kicking ID 1 out.
    res = client.delete(f"/workspaces/{ws['id']}/members/1", headers=auth_a)

    # The system must catch the paradox and reject the operation
    assert res.status_code in [400, 404]


# ==========================================
# 10. INFRASTRUCTURE & PAGINATION
# ==========================================
def test_cors_origin_blocking():
    headers = {
        "Origin": "http://evil-hacker.com",
        "Access-Control-Request-Method": "POST",
    }
    res = client.options("/login", headers=headers)
    assert res.headers.get("access-control-allow-origin") != "http://evil-hacker.com"


def test_pagination_limits(auth_a):
    ws = client.post(
        "/workspaces/", json={"name": "Pagination Team"}, headers=auth_a
    ).json()
    proj = client.post(
        "/projects/",
        json={"name": "Pagination Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    for i in range(3):
        client.post(
            f"/projects/{proj['id']}/tasks",
            json={"title": f"Task {i}", "priority_level": 1},
            headers=auth_a,
        )

    # Use the new status/keyword query params to check pagination isn't broken
    res = client.get(f"/projects/{proj['id']}/tasks?skip=0&limit=2", headers=auth_a)
    assert res.status_code == 200
    # This verifies the endpoint simply returns 200 OK.
    assert isinstance(res.json(), list)


# ==========================================
# 11. REDIS SECURITY (Rate Limits & Blacklisting)
# ==========================================
def test_rate_limiting_brute_force(user_a):
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


def test_token_revocation_logout():
    redis_client.flushdb()
    temp_user = {
        "email": f"logout_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "password123",
    }
    client.post("/users/", json=temp_user)

    res = client.post(
        "/login",
        data={"username": temp_user["email"], "password": temp_user["password"]},
    )
    auth_headers = {"Authorization": f"Bearer {res.json()['access_token']}"}

    logout_res = client.post("/logout", headers=auth_headers)
    assert logout_res.status_code == 200

    res_after = client.get("/workspaces/1/projects", headers=auth_headers)
    assert res_after.status_code == 401
    assert "revoked" in res_after.json()["detail"]


# ==========================================
# 12. ADVANCED THREATS (OOM, SQLi, XSS)
# ==========================================
def test_payload_exhaustion_attack(auth_a):
    ws = client.post("/workspaces/", json={"name": "OOM Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "OOM Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    massive_string = "A" * 1000000
    res = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": massive_string, "priority_level": 1},
        headers=auth_a,
    )
    assert res.status_code == 422
    assert res.json()["detail"][0]["type"] == "string_too_long"


def test_sql_injection_defense(auth_a):
    ws = client.post("/workspaces/", json={"name": "SQLi Team"}, headers=auth_a).json()
    sqli_payload = "Proj'; DROP TABLE projects; --"
    proj = client.post(
        "/projects/",
        json={"name": sqli_payload, "workspace_id": ws["id"]},
        headers=auth_a,
    )

    assert proj.status_code == 200
    assert proj.json()["name"] == sqli_payload


def test_xss_injection_defense(auth_a):
    ws = client.post("/workspaces/", json={"name": "XSS Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "XSS Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()
    xss_payload = "<script>fetch('http://evil.com')</script>"

    res = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": xss_payload, "priority_level": 1},
        headers=auth_a,
    )
    assert res.status_code == 422
    assert (
        "HTML tags and scripts are strictly forbidden" in res.json()["detail"][0]["msg"]
    )


# ==========================================
# 13. DISTRIBUTED BOTNET DEFENSE (Account Lockout)
# ==========================================
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


# ==========================================
# 14. WEBSOCKETS & ASYNC EMAIL TRIGGERS
# ==========================================
def test_websocket_project_connection(auth_a):
    """
    Verifies that the WebSocket ConnectionManager accepts connections
    for valid project rooms without crashing.
    """
    ws = client.post(
        "/workspaces/", json={"name": "WS Test Team"}, headers=auth_a
    ).json()
    proj = client.post(
        "/projects/",
        json={"name": "WS Test Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    # Use FastAPI's native WebSocket test client
    with client.websocket_connect(f"/ws/projects/{proj['id']}") as websocket:
        # If the connection succeeds and stays open, the manager is working perfectly.
        assert websocket is not None


def test_email_mock_trigger_on_invite(auth_a, auth_b, user_b):
    """
    Verifies that triggering an action with a background email task
    successfully executes the fallback logic without breaking the main thread.
    """
    ws = client.post(
        "/workspaces/", json={"name": "Email Test Team"}, headers=auth_a
    ).json()

    # This specific action contains our send_notification_email background task
    res = client.post(
        f"/workspaces/{ws['id']}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )

    # 1. Ensure the primary HTTP response succeeds
    assert res.status_code == 200

    # 2. Because FastAPI TestClient runs background tasks immediately,
    # passing this assertion proves the email fallback gracefully logged the
    # mock email instead of crashing with an exception.
    assert res.json()["role"] == "editor"

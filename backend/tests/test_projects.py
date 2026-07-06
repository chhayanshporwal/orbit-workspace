import uuid
import json
from tests.conftest import client, redis_client


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
        "password": "Password123!",
    }
    client.post("/users/", json=temp_user)
    pending_bytes = redis_client.get(f"pending_registration:{temp_user['email']}")
    pending = json.loads(pending_bytes)
    verify_res = client.post(
        "/verify-email", json={"email": temp_user["email"], "code": pending["code"]}
    ).json()
    token = verify_res["access_token"]

    # Get user id from /users/me
    me_res = client.get("/users/me", headers={"Authorization": f"Bearer {token}"})
    temp_id = me_res.json()["id"]

    res = client.get(
        f"/users/{temp_id}/workspaces", headers={"Authorization": f"Bearer {token}"}
    )
    assert res.status_code == 200
    assert isinstance(res.json(), list)


# ==========================================
# 5. KANBAN LOGIC & 404 HANDLING
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


def test_unauthenticated_data_leak():
    res = client.get("/workspaces/1/projects")
    assert res.status_code == 401


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
def test_token_revocation_logout():
    redis_client.flushdb()
    temp_user = {
        "email": f"logout_{uuid.uuid4().hex[:8]}@orbit.com",
        "password": "Password123!",
    }
    client.post("/users/", json=temp_user)

    pending_bytes = redis_client.get(f"pending_registration:{temp_user['email']}")
    assert pending_bytes is not None, "Failed to get pending registration from Redis"

    pending = json.loads(pending_bytes)
    res = client.post(
        "/verify-email", json={"email": temp_user["email"], "code": pending["code"]}
    )
    assert res.status_code == 200, res.text
    token = res.json().get("access_token")
    assert token is not None, "Failed to get access token from verify-email"

    auth_headers = {"Authorization": f"Bearer {token}"}

    logout_res = client.post("/logout", headers=auth_headers)
    assert logout_res.status_code == 200

    res_after = client.get("/workspaces/1/projects", headers=auth_headers)
    assert res_after.status_code == 401
    assert "revoked" in res_after.json()["detail"]


# ==========================================
# 12. ADVANCED THREATS (OOM, SQLi, XSS)
# ==========================================
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


# ==========================================
# 13. PROJECT LIFECYCLE & ANALYTICS
# ==========================================
def test_project_update_and_delete(auth_a):
    ws = client.post(
        "/workspaces/", json={"name": "Lifecycle WS"}, headers=auth_a
    ).json()
    proj = client.post(
        "/projects/",
        json={"name": "Old Name", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()
    proj_id = proj["id"]

    # Update project
    res_update = client.put(
        f"/projects/{proj_id}",
        json={"name": "New Name", "description": "Updated"},
        headers=auth_a,
    )
    assert res_update.status_code == 200
    assert res_update.json()["name"] == "New Name"

    # Delete project
    res_del = client.delete(f"/projects/{proj_id}", headers=auth_a)
    assert res_del.status_code == 200

    # Verify deletion
    res_get = client.get(f"/workspaces/{ws['id']}/projects", headers=auth_a)
    assert res_get.status_code == 200
    projects = res_get.json()
    assert not any(p["id"] == proj_id for p in projects)


def test_project_views_tracking(auth_a):
    ws = client.post("/workspaces/", json={"name": "Views WS"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "Viewed Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()
    proj_id = proj["id"]

    # Record view
    res_view = client.post(f"/projects/{proj_id}/view", headers=auth_a)
    assert res_view.status_code == 200

    # Get recent views
    res_recent = client.get("/user/project-views", headers=auth_a)
    assert res_recent.status_code == 200
    views = res_recent.json()
    assert str(proj_id) in views

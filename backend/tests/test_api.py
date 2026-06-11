import pytest
from fastapi.testclient import TestClient
from main import app
import uuid

client = TestClient(app)

# ==========================================
# FIXTURES (The Setup Robots)
# ==========================================
@pytest.fixture(scope="module")
def user_a():
    return {"email": f"alice_{uuid.uuid4().hex[:8]}@orbit.com", "password": "password123"}

@pytest.fixture(scope="module")
def auth_a(user_a):
    client.post("/users/", json=user_a)
    token = client.post("/login", data={"username": user_a["email"], "password": user_a["password"]}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

@pytest.fixture(scope="module")
def user_b():
    return {"email": f"hacker_bob_{uuid.uuid4().hex[:8]}@orbit.com", "password": "password123"}

@pytest.fixture(scope="module")
def auth_b(user_b):
    client.post("/users/", json=user_b)
    token = client.post("/login", data={"username": user_b["email"], "password": user_b["password"]}).json()["access_token"]
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
    temp_user = {"email": f"dup_{uuid.uuid4().hex[:8]}@orbit.com", "password": "password123"}
    client.post("/users/", json=temp_user)
    res = client.post("/users/", json=temp_user)
    
    assert res.status_code == 400
    assert res.json()["detail"] == "Email already registered"

def test_login_wrong_password(user_a):
    res = client.post("/login", data={"username": user_a["email"], "password": "wrongpassword!"})
    assert res.status_code == 400

def test_login_nonexistent_user():
    res = client.post("/login", data={"username": "ghost@orbit.com", "password": "password123"})
    assert res.status_code == 400

def test_access_with_fake_token():
    # Attempt to bypass the security guard with a fabricated JWT
    res = client.post("/workspaces/", json={"name": "Hacker Room"}, headers={"Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.fake.signature"})
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
    # We need the user's ID to fetch their workspaces
    # First, let's login to get the token again, and decode the email to find the user in a real scenario
    # For this test, we'll just register a quick temporary user to get a clean ID
    temp_user = {"email": f"temp_{uuid.uuid4().hex[:8]}@orbit.com", "password": "temp"}
    temp_id = client.post("/users/", json=temp_user).json()["id"]
    
    res = client.get(f"/users/{temp_id}/workspaces")
    assert res.status_code == 200
    assert isinstance(res.json(), list) # Ensure it returns a list array

# ==========================================
# 5. KANBAN LOGIC & 404 HANDLING
# ==========================================
def test_create_and_update_task(auth_a):
    # Setup parent containers
    ws = client.post("/workspaces/", json={"name": "Beta Team"}, headers=auth_a).json()
    proj = client.post("/projects/", json={"name": "Proj 1", "workspace_id": ws['id']}, headers=auth_a).json()
    
    # Create the task
    task = client.post(f"/projects/{proj['id']}/tasks", json={"title": "Fix Bug", "priority_level": 1}, headers=auth_a).json()
    assert task["status"] == "To Do"
    
    # Drag and Drop Update
    updated_task = client.put(f"/tasks/{task['id']}", json={"status": "In Progress"}, headers=auth_a).json()
    assert updated_task["status"] == "In Progress"

def test_update_nonexistent_task(auth_a):
    # Ensure database doesn't crash on invalid IDs
    res = client.put("/tasks/999999", json={"status": "Done"}, headers=auth_a)
    assert res.status_code == 404
    assert res.json()["detail"] == "Task not found"

# ==========================================
# 6. ADVANCED SECURITY & RELATIONAL INTEGRITY
# ==========================================
def test_idor_vulnerability(auth_a, auth_b):
    # 1. Alice creates a private workspace
    ws_alice = client.post("/workspaces/", json={"name": "Alice's Secret Vault"}, headers=auth_a).json()
    
    # 2. Bob tries to sneak into Alice's workspace to create a project
    # He uses HIS token (auth_b) but points to HER workspace ID (ws_alice['id'])
    res = client.post(
        "/projects/", 
        json={"name": "Bob's Malware", "workspace_id": ws_alice['id']}, 
        headers=auth_b
    )
    
    # This SHOULD be blocked with a 403 Forbidden or 401 Unauthorized
    assert res.status_code in [401, 403, 404]

def test_foreign_key_phantom(auth_a):
    # Attempt to create a task in a project that doesn't exist
    res = client.post(
        "/projects/999999/tasks", 
        json={"title": "Ghost Task", "priority_level": 1}, 
        headers=auth_a
    )
    # The database should reject this relational mismatch
    assert res.status_code == 404 
    # Or 400/422 depending on how we handle SQL errors

def test_pydantic_strict_typing(auth_a):
    # Setup a valid workspace and project first
    ws = client.post("/workspaces/", json={"name": "Type Test Team"}, headers=auth_a).json()
    proj = client.post("/projects/", json={"name": "Type Test Proj", "workspace_id": ws['id']}, headers=auth_a).json()
    
    # Attempt to send a string ("URGENT") to an integer field (priority_level)
    res = client.post(
        f"/projects/{proj['id']}/tasks", 
        json={"title": "Type Mismatch", "priority_level": "URGENT"}, 
        headers=auth_a
    )
    # Pydantic MUST catch this before it hits the database
    assert res.status_code == 422
    assert res.json()["detail"][0]["type"] == "int_parsing"

# ==========================================
# 7. UNCOVERED EDGE CASES (Data Leaks & State)
# ==========================================
def test_unauthenticated_data_leak():
    # A hacker tries to read the projects of workspace ID 1 without logging in.
    # They don't have a token. They are just guessing the URL.
    res = client.get("/workspaces/1/projects")
    
    # This MUST be blocked with a 401 Unauthorized.
    assert res.status_code == 401

def test_invalid_kanban_state(auth_a):
    # Setup parent containers
    ws = client.post("/workspaces/", json={"name": "State Team"}, headers=auth_a).json()
    proj = client.post("/projects/", json={"name": "State Proj", "workspace_id": ws['id']}, headers=auth_a).json()
    task = client.post(f"/projects/{proj['id']}/tasks", json={"title": "Test State", "priority_level": 1}, headers=auth_a).json()

    # Try to move the task to a column that doesn't exist
    res = client.put(f"/tasks/{task['id']}", json={"status": "HACKED COLUMN"}, headers=auth_a)
    
    # Pydantic should strictly reject this with a 422 Unprocessable Entity
    assert res.status_code == 422

# ==========================================
# 8. INFRASTRUCTURE & PAGINATION
# ==========================================
def test_cors_origin_blocking():
    # A malicious website tries to make an OPTIONS preflight request to your API
    headers = {
        "Origin": "http://evil-hacker.com",
        "Access-Control-Request-Method": "POST"
    }
    res = client.options("/login", headers=headers)
    
    # If CORS is secure, Starlette will NOT return the evil domain in the allowed header
    assert res.headers.get("access-control-allow-origin") != "http://evil-hacker.com"

def test_pagination_limits(auth_a):
    # 1. Setup workspace and project
    ws = client.post("/workspaces/", json={"name": "Pagination Team"}, headers=auth_a).json()
    proj = client.post("/projects/", json={"name": "Pagination Proj", "workspace_id": ws['id']}, headers=auth_a).json()
    
    # 2. Create 3 tasks rapidly
    for i in range(3):
        client.post(f"/projects/{proj['id']}/tasks", json={"title": f"Task {i}", "priority_level": 1}, headers=auth_a)
        
    # 3. Request tasks but strictly ask the server to limit the response to 2
    res = client.get(f"/projects/{proj['id']}/tasks?skip=0&limit=2", headers=auth_a)
    
    assert res.status_code == 200
    # Ensure the server only returned 2 tasks, effectively preventing RAM exhaustion
    assert len(res.json()) == 2
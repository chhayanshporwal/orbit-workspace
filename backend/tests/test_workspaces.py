from tests.conftest import client


# ==========================================
# WORKSPACE INVITATIONS & REQUESTS
# ==========================================
def test_workspace_invitations_and_requests(auth_a, auth_b, user_b):
    # 1. User A creates a workspace
    res_ws = client.post("/workspaces/", json={"name": "Alpha Corp"}, headers=auth_a)
    assert res_ws.status_code == 200
    ws_id = res_ws.json()["id"]

    # 2. User A invites User B
    res_invite = client.post(
        f"/workspaces/{ws_id}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )
    assert res_invite.status_code == 200

    # User B should have a pending invitation. Get the membership ID.
    res_ws_b = client.get("/workspace-invitations", headers=auth_b)
    members = res_ws_b.json()
    b_membership = next(m for m in members if m["workspace_id"] == ws_id)
    mem_id = b_membership["id"]

    # 3. User B rejects the invitation
    res_reject = client.post(f"/workspace-invitations/{mem_id}/reject", headers=auth_b)
    assert res_reject.status_code == 200

    # User A invites User B again
    res_invite2 = client.post(
        f"/workspaces/{ws_id}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )
    assert res_invite2.status_code == 200
    res_ws_b2 = client.get("/workspace-invitations", headers=auth_b)
    members2 = res_ws_b2.json()
    b_membership2 = next(m for m in members2 if m["workspace_id"] == ws_id)
    mem_id2 = b_membership2["id"]

    # 4. User B accepts the invitation
    res_accept = client.post(f"/workspace-invitations/{mem_id2}/accept", headers=auth_b)
    assert res_accept.status_code == 200

    # 5. User B requests to leave
    res_leave = client.post(f"/workspaces/{ws_id}/leave-requests", headers=auth_b)
    assert res_leave.status_code == 200

    # 6. User A requests to delete the workspace
    res_del_req = client.post(f"/workspaces/{ws_id}/delete-requests", headers=auth_a)
    assert res_del_req.status_code == 200

    # 7. User A actually deletes the workspace (soft delete) - returns 404 because delete-requests already deleted it
    res_delete = client.delete(f"/workspaces/{ws_id}", headers=auth_a)
    assert res_delete.status_code == 404

    # 8. Verify the workspace is no longer listed for User A
    res_me = client.get("/users/me", headers=auth_a)
    user_id = res_me.json()["id"]

    res_my_ws = client.get(f"/users/{user_id}/workspaces", headers=auth_a)
    ws_ids = [w["id"] for w in res_my_ws.json()]
    assert ws_id not in ws_ids


def test_get_nonexistent_workspace(auth_a):
    response = client.delete("/workspaces/9999", headers=auth_a)
    assert response.status_code == 404
    assert response.json()["detail"] == "Workspace not found"


def test_create_workspace_invalid_data(auth_a):
    payload = {"description": "This should fail because name is missing"}
    response = client.post("/workspaces/", json=payload, headers=auth_a)
    assert response.status_code == 422


def test_remove_member_not_admin(auth_a, auth_b, user_b):
    # User A creates workspace
    ws_res = client.post("/workspaces/", json={"name": "Test Cover"}, headers=auth_a)
    ws_id = ws_res.json()["id"]
    # User A invites User B as editor
    client.post(
        f"/workspaces/{ws_id}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )
    # User B accepts
    inv_res = client.get("/workspace-invitations", headers=auth_b)
    mem_id = next(m["id"] for m in inv_res.json() if m["workspace_id"] == ws_id)
    client.post(f"/workspace-invitations/{mem_id}/accept", headers=auth_b)

    # User B tries to remove User A (Not admin)
    me_res = client.get("/users/me", headers=auth_a)
    user_a_id = me_res.json()["id"]
    del_res = client.delete(f"/workspaces/{ws_id}/members/{user_a_id}", headers=auth_b)
    assert del_res.status_code == 403


def test_remove_last_admin(auth_a):
    # User A creates workspace
    ws_res = client.post("/workspaces/", json={"name": "Test Cover 2"}, headers=auth_a)
    ws_id = ws_res.json()["id"]

    me_res = client.get("/users/me", headers=auth_a)
    user_a_id = me_res.json()["id"]

    # User A tries to remove themselves (they are the last admin)
    del_res = client.delete(f"/workspaces/{ws_id}/members/{user_a_id}", headers=auth_a)
    assert del_res.status_code == 400

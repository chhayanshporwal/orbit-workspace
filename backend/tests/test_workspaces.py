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

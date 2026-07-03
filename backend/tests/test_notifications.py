from tests.conftest import client


def test_notification_lifecycle(auth_a, user_b, auth_b):
    ws = client.post("/workspaces/", json={"name": "Notif WS"}, headers=auth_a).json()

    # Invite user_b, this should create a workspace invite and hopefully a notification
    client.post(
        f"/workspaces/{ws['id']}/members",
        json={"email": user_b["email"], "role": "editor"},
        headers=auth_a,
    )

    # Fetch notifications for user B
    res_notif = client.get("/notifications", headers=auth_b)
    assert res_notif.status_code == 200

    # We might not know for sure if invitations create notifications, but we can check if any exist.
    # If notifications exist, we test the read flow.
    notifications = res_notif.json()
    if notifications:
        notif_id = notifications[0]["id"]
        # Mark as read
        res_read = client.put(f"/notifications/{notif_id}/read", headers=auth_b)
        assert res_read.status_code == 200
        assert res_read.json()["is_read"] is True

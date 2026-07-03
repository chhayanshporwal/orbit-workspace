from tests.conftest import client


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

    # Extract the token string from the Bearer header
    token = auth_a["Authorization"].split(" ")[1]

    # Use FastAPI's native WebSocket test client with the token query param
    with client.websocket_connect(
        f"/ws/projects/{proj['id']}?token={token}"
    ) as websocket:
        # If the connection succeeds and stays open, the manager is working perfectly.
        assert websocket is not None

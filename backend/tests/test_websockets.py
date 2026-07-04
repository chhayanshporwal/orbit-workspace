import pytest
from tests.conftest import client
from unittest.mock import AsyncMock
from core.websocket import ConnectionManager


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


@pytest.fixture
def manager():
    return ConnectionManager()


@pytest.fixture
def mock_websocket():
    ws = AsyncMock()
    ws.accept = AsyncMock()
    ws.send_json = AsyncMock()
    return ws


@pytest.mark.anyio
async def test_personal_connection_lifecycle(manager, mock_websocket):
    user_id = 1
    # Connect
    await manager.connect(mock_websocket, user_id)
    assert mock_websocket.accept.called
    assert user_id in manager.active_connections
    assert mock_websocket in manager.active_connections[user_id]

    # Broadcast (success)
    await manager.broadcast_to_users([user_id], {"hello": "world"})
    mock_websocket.send_json.assert_called_with({"hello": "world"})

    # Send personal message failure (should disconnect)
    mock_websocket.send_json.side_effect = Exception("Connection closed")
    await manager.send_personal_message({"test": "fail"}, user_id)
    # The dead connection should be removed
    assert user_id not in manager.active_connections


@pytest.mark.anyio
async def test_project_connection_lifecycle(manager, mock_websocket):
    project_id = 100
    user_id = 1

    # Connect to project
    await manager.connect_project(mock_websocket, project_id, user_id)
    assert mock_websocket.accept.called
    assert project_id in manager.project_connections

    # Broadcast to project (success)
    await manager.broadcast_to_project(project_id, {"event": "test"})
    mock_websocket.send_json.assert_called_with({"event": "test"})

    # Broadcast to project (excluding self)
    mock_websocket.send_json.reset_mock()
    await manager.broadcast_to_project(
        project_id, {"event": "test2"}, exclude_user_id=user_id
    )
    mock_websocket.send_json.assert_not_called()

    # Broadcast to project failure (should disconnect)
    mock_websocket.send_json.side_effect = Exception("Connection closed")
    await manager.broadcast_to_project(project_id, {"event": "fail"})
    # Dead connection should be removed
    assert project_id not in manager.project_connections

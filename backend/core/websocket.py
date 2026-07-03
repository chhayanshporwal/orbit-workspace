from fastapi import WebSocket
from typing import List, Dict


class ConnectionManager:
    def __init__(self):
        # Maps user_id to active WebSocket connections
        self.active_connections: Dict[int, List[WebSocket]] = {}
        # Maps project_id to list of dicts: {"websocket": WebSocket, "user_id": int}
        self.project_connections: Dict[int, List[Dict]] = {}

    async def connect(self, websocket: WebSocket, user_id: int):
        await websocket.accept()
        if user_id not in self.active_connections:
            self.active_connections[user_id] = []
        self.active_connections[user_id].append(websocket)

    def disconnect(self, websocket: WebSocket, user_id: int):
        if user_id in self.active_connections:
            if websocket in self.active_connections[user_id]:
                self.active_connections[user_id].remove(websocket)
            if not self.active_connections[user_id]:
                del self.active_connections[user_id]

    async def send_personal_message(self, message: dict, user_id: int):
        if user_id in self.active_connections:
            dead_connections = []
            for connection in self.active_connections[user_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    dead_connections.append(connection)
            for dead in dead_connections:
                self.disconnect(dead, user_id)

    async def broadcast_to_users(self, user_ids: List[int], message: dict):
        for uid in user_ids:
            await self.send_personal_message(message, uid)

    async def connect_project(
        self, websocket: WebSocket, project_id: int, user_id: int
    ):
        await websocket.accept()
        if project_id not in self.project_connections:
            self.project_connections[project_id] = []
        self.project_connections[project_id].append(
            {"websocket": websocket, "user_id": user_id}
        )

    def disconnect_project(self, websocket: WebSocket, project_id: int, user_id: int):
        if project_id in self.project_connections:
            self.project_connections[project_id] = [
                conn
                for conn in self.project_connections[project_id]
                if conn["websocket"] != websocket
            ]
            if not self.project_connections[project_id]:
                del self.project_connections[project_id]

    async def broadcast_to_project(
        self, project_id: int, message: dict, exclude_user_id: int = None
    ):
        if project_id in self.project_connections:
            dead_connections = []
            for connection in self.project_connections[project_id]:
                if exclude_user_id is None or connection["user_id"] != exclude_user_id:
                    try:
                        await connection["websocket"].send_json(message)
                    except Exception:
                        dead_connections.append(connection)
            for dead in dead_connections:
                self.disconnect_project(dead["websocket"], project_id, dead["user_id"])


manager = ConnectionManager()

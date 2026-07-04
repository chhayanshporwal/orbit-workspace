import pytest
import os
import httpx
from unittest.mock import patch, MagicMock, AsyncMock
from services.email_service import send_notification_email


@pytest.mark.anyio
async def test_send_notification_email_dummy_key():
    with patch.dict(os.environ, {"RESEND_API_KEY": "your_dummy_key"}):
        res = await send_notification_email("test@example.com", "Subj", "Body")
        assert res["status"] == "mocked"


@pytest.mark.anyio
async def test_send_notification_email_success():
    with patch.dict(os.environ, {"RESEND_API_KEY": "valid_key"}):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json.return_value = {"id": "123"}

        mock_post = AsyncMock(return_value=mock_response)

        with patch("httpx.AsyncClient.post", mock_post):
            res = await send_notification_email("test@example.com", "Subj", "Body")
            assert res["status"] == "success"
            assert res["data"]["id"] == "123"


@pytest.mark.anyio
async def test_send_notification_email_http_error():
    with patch.dict(os.environ, {"RESEND_API_KEY": "valid_key"}):
        mock_request = MagicMock()
        mock_request.url = "https://api.resend.com/emails"

        mock_response = MagicMock()
        mock_response.status_code = 403
        mock_response.text = "Forbidden"

        mock_post = AsyncMock(
            side_effect=httpx.HTTPStatusError(
                "API Error", request=mock_request, response=mock_response
            )
        )

        with patch("httpx.AsyncClient.post", mock_post):
            res = await send_notification_email("test@example.com", "Subj", "Body")
            assert res["status"] == "error"
            assert res["type"] == "http_error"
            assert "403" in res["detail"]


@pytest.mark.anyio
async def test_send_notification_email_network_error():
    with patch.dict(os.environ, {"RESEND_API_KEY": "valid_key"}):
        mock_request = MagicMock()
        mock_request.url = "https://api.resend.com/emails"

        mock_post = AsyncMock(
            side_effect=httpx.RequestError("DNS Failed", request=mock_request)
        )

        with patch("httpx.AsyncClient.post", mock_post):
            res = await send_notification_email("test@example.com", "Subj", "Body")
            assert res["status"] == "error"
            assert res["type"] == "network_error"
            assert "DNS Failed" in res["detail"]


@pytest.mark.anyio
async def test_send_notification_email_generic_error():
    with patch.dict(os.environ, {"RESEND_API_KEY": "valid_key"}):
        mock_post = AsyncMock(side_effect=ValueError("Unexpected Error"))

        with patch("httpx.AsyncClient.post", mock_post):
            res = await send_notification_email("test@example.com", "Subj", "Body")
            assert res["status"] == "error"
            assert res["type"] == "internal_error"
            assert "Unexpected Error" in res["detail"]

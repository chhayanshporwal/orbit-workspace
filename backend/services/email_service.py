import os
import httpx
import logging

from dotenv import load_dotenv

# Configure highly visible and debuggable logging
logging.basicConfig(
    level=logging.INFO, format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s"
)
logger = logging.getLogger("orbit.email_service")

# Load dotenv to find .env file in WORKDIR
load_dotenv()


async def send_notification_email(to_email: str, subject: str, body: str):
    """
    Dispatches an email via Resend API with comprehensive error handling.
    """
    resend_key = os.getenv("RESEND_API_KEY", "your_dummy_key")

    # 1. The Local Development Mock
    if not resend_key or resend_key == "your_dummy_key":
        logger.info(
            f"🛑 [MOCK EMAIL] To: {to_email} | Subject: {subject} | Body: {body}"
        )
        return {"status": "mocked", "message": "Email skipped - using dummy key"}

    # 2. The Production Payload
    headers = {
        "Authorization": f"Bearer {resend_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "from": "Orbit Notifications <noreply@orbitworkspace.xyz>",
        "to": to_email,
        "subject": subject,
        "html": f"<div style='font-family: sans-serif;'><h2>Orbit Alert</h2><p>{body}</p></div>",
    }

    # 3. The Asynchronous HTTP Request with Exception Handling
    try:
        # Added a strict 10-second timeout so a slow API doesn't hang your server
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.post(
                "https://api.resend.com/emails", headers=headers, json=payload
            )

            # Will raise an exception for 4xx or 5xx status codes
            response.raise_for_status()

            logger.info(f"✅ [EMAIL SENT] Successfully dispatched to {to_email}")
            return {"status": "success", "data": response.json()}

    except httpx.HTTPStatusError as e:
        # Triggered when Resend rejects the request (e.g., bad API key, rate limit)
        error_msg = f"API Error {e.response.status_code}: {e.response.text}"
        logger.error(f"❌ [EMAIL FAILED] {error_msg} | Payload: {payload}")
        return {"status": "error", "type": "http_error", "detail": error_msg}

    except httpx.RequestError as e:
        # Triggered on DNS failures, refused connections, or timeouts
        error_msg = f"Network Exception: {str(e)}"
        logger.error(f"❌ [EMAIL FAILED] {error_msg} | Target: {e.request.url}")
        return {"status": "error", "type": "network_error", "detail": error_msg}

    except Exception as e:
        # Catch-all for unexpected Python-level crashes
        logger.exception(
            f"🚨 [EMAIL CRITICAL] Unexpected failure sending to {to_email}: {str(e)}"
        )
        return {"status": "error", "type": "internal_error", "detail": str(e)}

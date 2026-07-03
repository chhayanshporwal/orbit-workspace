import jwt
import random
import json
import os
import uuid
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks, Form
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from core.database import get_db, User, UserProfileHistory, UserSession
from core.security import (
    get_password_hash,
    verify_password,
    create_access_token,
    get_current_user,
    oauth2_scheme,
    SECRET_KEY,
    ALGORITHM,
)
from core.redis_client import redis_client, limiter
from services.email_service import send_notification_email
from models import schemas

router = APIRouter()


class RememberDeviceRequest(schemas.BaseModel):
    device_id: str
    device_name: Optional[str] = None


def check_password_reuse(user: User, new_password: str, db: Session):
    # 1. Compare with current password
    if verify_password(new_password, user.hashed_password):
        raise HTTPException(
            status_code=400, detail="Cannot reuse your current password."
        )

    # 2. Compare with previous passwords from UserProfileHistory
    histories = (
        db.query(UserProfileHistory)
        .filter(
            UserProfileHistory.user_id == user.id,
            UserProfileHistory.field_name == "password",
        )
        .all()
    )
    for h in histories:
        if h.old_value and verify_password(new_password, h.old_value):
            raise HTTPException(
                status_code=400, detail="Cannot reuse a previous password."
            )


@router.post("/users/", response_model=schemas.RegistrationResponse)
@limiter.limit("5/minute")
def register_user(
    request: Request,
    user: schemas.UserCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    if db.query(User).filter(User.email == user.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    code = f"{random.randint(100000, 999999)}"
    pending_data = {
        "email": user.email,
        "hashed_password": get_password_hash(user.password),
        "name": user.name,
        "code": code,
    }
    redis_client.set(
        f"pending_registration:{user.email}", json.dumps(pending_data), ex=900
    )

    # Dispatch verification email
    msg = f"Your Orbit verification code is: {code}"
    background_tasks.add_task(
        send_notification_email,
        to_email=user.email,
        subject="Verify your Orbit Account",
        body=msg,
    )

    return {
        "email": user.email,
        "status": "success",
        "message": "Verification code sent to email.",
    }


@router.post("/verify-email", response_model=schemas.UserResponse)
def verify_email(payload: schemas.UserVerify, db: Session = Depends(get_db)):
    # Check if user is already registered in DB
    existing_user = db.query(User).filter(User.email == payload.email).first()
    if existing_user:
        if existing_user.is_verified:
            return existing_user
        if existing_user.verification_code == payload.code:
            existing_user.is_verified = True
            existing_user.verification_code = None
            db.commit()
            db.refresh(existing_user)
            return existing_user
        raise HTTPException(status_code=400, detail="Invalid verification code")

    # Fetch pending from Redis
    redis_key = f"pending_registration:{payload.email}"
    pending_bytes = redis_client.get(redis_key)
    if not pending_bytes:
        raise HTTPException(
            status_code=400, detail="Invalid or expired verification session"
        )

    pending_data = json.loads(pending_bytes)
    if pending_data["code"] != payload.code:
        raise HTTPException(status_code=400, detail="Invalid verification code")

    # Save user to DB
    new_user = User(
        email=pending_data["email"],
        hashed_password=pending_data["hashed_password"],
        name=pending_data.get("name"),
        is_verified=True,
        verification_code=None,
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Remove Redis key
    redis_client.delete(redis_key)
    return new_user


@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(
    request: Request,
    payload: schemas.ForgotPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        return {
            "status": "success",
            "message": "If the email is registered, a reset code was sent",
        }

    otp = f"{random.randint(100000, 999999)}"
    user.reset_otp = otp
    user.reset_otp_expiry = datetime.now(timezone.utc) + timedelta(minutes=15)
    db.commit()

    msg = f"Your Orbit password reset code is: {otp}. It will expire in 15 minutes."
    background_tasks.add_task(
        send_notification_email,
        to_email=user.email,
        subject="Reset your Orbit Password",
        body=msg,
    )
    return {"status": "success", "message": "Reset code sent successfully"}


@router.post("/verify-reset-otp")
@limiter.limit("5/minute")
def verify_reset_otp(
    request: Request,
    payload: schemas.VerifyResetOTPRequest,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.reset_otp or user.reset_otp != payload.otp:
        raise HTTPException(status_code=400, detail="Invalid reset OTP")

    now = datetime.now(timezone.utc)
    expiry = user.reset_otp_expiry
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if expiry and expiry < now:
        raise HTTPException(status_code=400, detail="Reset OTP has expired")

    return {"status": "success", "message": "OTP verified successfully"}


@router.post("/reset-password")
def reset_password(
    payload: schemas.ResetPasswordRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    user = db.query(User).filter(User.email == payload.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.reset_otp or user.reset_otp != payload.otp:
        raise HTTPException(status_code=400, detail="Invalid reset OTP")

    now = datetime.now(timezone.utc)
    expiry = user.reset_otp_expiry
    if expiry and expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)

    if expiry and expiry < now:
        raise HTTPException(status_code=400, detail="Reset OTP has expired")

    # Check password reuse
    check_password_reuse(user, payload.new_password, db)

    # Record old password to history
    db.add(
        UserProfileHistory(
            user_id=user.id, field_name="password", old_value=user.hashed_password
        )
    )

    user.hashed_password = get_password_hash(payload.new_password)
    user.reset_otp = None
    user.reset_otp_expiry = None

    db.query(UserSession).filter(
        UserSession.user_id == user.id, UserSession.is_active.is_(True)
    ).update({"is_active": False, "logout_at": datetime.now(timezone.utc)})

    db.commit()

    background_tasks.add_task(
        send_notification_email,
        to_email=user.email,
        subject="Orbit Password Changed",
        body="Your Orbit password has been successfully reset. If you did not request this change, please contact support immediately.",
    )
    return {"status": "success", "message": "Password updated successfully"}


@router.post("/login")
@limiter.limit("5/minute")
def login(
    request: Request,
    background_tasks: BackgroundTasks,
    form_data: OAuth2PasswordRequestForm = Depends(),
    device_id: Optional[str] = Form(None),
    device_name: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    email = form_data.username
    lockout_key, failed_attempts_key = f"lockout:{email}", f"failed_attempts:{email}"

    if redis_client.get(lockout_key):
        raise HTTPException(status_code=403, detail="Account locked.")

    user = db.query(User).filter(User.email == email).first()

    if not user and redis_client.get(f"pending_registration:{email}"):
        raise HTTPException(status_code=400, detail="Email not verified")

    dummy_hash = "$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjIQqiRQYq"
    is_valid = (
        verify_password(form_data.password, user.hashed_password)
        if user
        else verify_password(form_data.password, dummy_hash)
    )

    if not user or not is_valid:
        redis_client.incr(failed_attempts_key)
        if redis_client.ttl(failed_attempts_key) == -1:
            redis_client.expire(failed_attempts_key, 600)
        if int(redis_client.get(failed_attempts_key) or 0) >= 10:
            redis_client.set(name=lockout_key, value="locked", ex=900)
            redis_client.delete(failed_attempts_key)
            raise HTTPException(status_code=403, detail="Account locked.")
        raise HTTPException(status_code=400, detail="Incorrect email or password")

    redis_client.delete(failed_attempts_key)

    if not user.is_verified:
        raise HTTPException(status_code=400, detail="Email not verified")

    # Create active session in DB
    jti = str(uuid.uuid4())
    dev_id = device_id or "unknown_device"
    dev_name = device_name or request.headers.get("user-agent", "Unknown Device")
    ip_addr = request.client.host if request.client else "127.0.0.1"

    is_new_device = (
        db.query(UserSession).filter_by(user_id=user.id, device_id=dev_id).first()
        is None
    )

    import httpx

    location = None
    if ip_addr and ip_addr not in ("127.0.0.1", "::1", "localhost"):
        try:
            res = httpx.get(f"http://ip-api.com/json/{ip_addr}", timeout=2.0)
            if res.status_code == 200:
                data = res.json()
                if data.get("status") == "success":
                    location = (
                        f"{data.get('city', '')}, {data.get('country', '')}".strip(", ")
                    )
        except Exception:
            pass

    db_session = UserSession(
        user_id=user.id,
        device_id=dev_id,
        device_name=dev_name,
        ip_address=ip_addr,
        location=location,
        token_jti=jti,
        is_active=True,
    )
    db.add(db_session)
    db.commit()

    if is_new_device:
        now_str = datetime.now().strftime("%B %d, %Y at %I:%M %p")
        frontend_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
        msg = (
            "We noticed a login from a device you don't usually use.\n\n"
            "Was this you?\n\n"
            f"When: {now_str}\n"
            f"Device: {dev_name}\n"
            f"Where: {location or 'Unknown'} (IP: {ip_addr})\n\n"
            "If this was you, you can ignore this message. There's no need to take any action.\n\n"
            "If this wasn't you, your account may have been compromised. Please secure your account immediately by resetting your password here:\n"
            f"{frontend_url}/forgot-password"
        )
        background_tasks.add_task(
            send_notification_email,
            to_email=user.email,
            subject="New Device Login - Orbit Workspace",
            body=msg,
        )

    return {
        "access_token": create_access_token(
            {"sub": user.email, "jti": jti, "device_id": dev_id}
        ),
        "token_type": "bearer",
        "deletion_scheduled_at": (
            user.deletion_scheduled_at.isoformat()
            if user.deletion_scheduled_at
            else None
        ),
    }


@router.post("/logout")
def logout(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = payload.get("jti")
        expire_timestamp = payload.get("exp")
        if expire_timestamp is None:
            raise HTTPException(
                status_code=401, detail="Invalid token: Missing expiration claim"
            )

        # Mark current session inactive
        if jti:
            db.query(UserSession).filter_by(token_jti=jti).update(
                {"is_active": False, "logout_at": datetime.now(timezone.utc)}
            )
            db.commit()

        time_remaining = int(expire_timestamp - datetime.now(timezone.utc).timestamp())
        if time_remaining > 0:
            redis_client.set(name=token, value="revoked", ex=time_remaining)
        return {"status": "success", "message": "Successfully logged out"}
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Could not validate credentials")


@router.get("/users/me", response_model=schemas.UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.put("/users/me", response_model=schemas.UserResponse)
def update_profile(
    update_data: schemas.UserProfileUpdate,
    background_tasks: BackgroundTasks,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if update_data.name is not None and update_data.name != current_user.name:
        # Record old name to history
        db.add(
            UserProfileHistory(
                user_id=current_user.id, field_name="name", old_value=current_user.name
            )
        )
        current_user.name = update_data.name

    if update_data.password is not None:
        # Require current_password verification for profile password updates
        if not update_data.current_password:
            raise HTTPException(
                status_code=400,
                detail="Current password is required to change password",
            )
        if not verify_password(
            update_data.current_password, current_user.hashed_password
        ):
            raise HTTPException(status_code=400, detail="Incorrect current password")

        # Check password reuse
        check_password_reuse(current_user, update_data.password, db)

        # Record old password to history
        db.add(
            UserProfileHistory(
                user_id=current_user.id,
                field_name="password",
                old_value=current_user.hashed_password,
            )
        )
        current_user.hashed_password = get_password_hash(update_data.password)

        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            current_jti = payload.get("jti")
        except Exception:
            current_jti = None

        db.query(UserSession).filter(
            UserSession.user_id == current_user.id,
            UserSession.token_jti != current_jti,
            UserSession.is_active.is_(True),
        ).update({"is_active": False, "logout_at": datetime.now(timezone.utc)})

        background_tasks.add_task(
            send_notification_email,
            to_email=current_user.email,
            subject="Orbit Password Changed",
            body="Your Orbit password has been updated via profile settings. If you did not make this change, please contact support immediately.",
        )

    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/users/me/sessions", response_model=List[schemas.UserSessionResponse])
def get_user_sessions(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        jwt_payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = jwt_payload.get("jti")
    except Exception:
        jti = None

    sessions = (
        db.query(UserSession)
        .filter(UserSession.user_id == current_user.id)
        .order_by(UserSession.login_at.desc())
        .all()
    )
    for s in sessions:
        s.is_current_session = s.token_jti == jti
    return sessions


@router.post("/users/me/sessions/{session_id}/revoke")
def revoke_user_session(
    session_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    session = (
        db.query(UserSession).filter_by(id=session_id, user_id=current_user.id).first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session.is_active = False
    session.logout_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "success", "message": "Session successfully revoked"}


@router.post("/auth/remember-device")
def remember_device(
    payload: RememberDeviceRequest,
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        jwt_payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = jwt_payload.get("jti")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

    session = (
        db.query(UserSession).filter_by(token_jti=jti, user_id=current_user.id).first()
    )
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    new_jti = str(uuid.uuid4())
    new_token = create_access_token(
        {"sub": current_user.email, "jti": new_jti, "device_id": payload.device_id},
        expires_delta=timedelta(days=30),
    )

    session.is_active = False
    session.logout_at = datetime.now(timezone.utc)

    new_session = UserSession(
        user_id=current_user.id,
        device_id=payload.device_id,
        device_name=payload.device_name or session.device_name,
        ip_address=session.ip_address,
        token_jti=new_jti,
        is_active=True,
    )
    db.add(new_session)
    db.commit()

    return {"access_token": new_token, "token_type": "bearer"}


@router.post("/auth/google")
def google_login(
    payload: schemas.GoogleLoginRequest, request: Request, db: Session = Depends(get_db)
):
    code = payload.code
    redirect_uri = payload.redirect_uri

    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "mock-google-client-id")
    GOOGLE_CLIENT_SECRET = os.getenv(
        "GOOGLE_CLIENT_SECRET", "mock-google-client-secret"
    )

    if GOOGLE_CLIENT_ID == "mock-google-client-id":
        email = "google-user@example.com"
        name = "Google User"
    else:
        import httpx

        token_url = "https://oauth2.googleapis.com/token"
        data = {
            "code": code,
            "client_id": GOOGLE_CLIENT_ID,
            "client_secret": GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        }
        res = httpx.post(token_url, data=data)
        if res.status_code != 200:
            print("Google OAuth Error:", res.text)
            raise HTTPException(
                status_code=400, detail="Failed to exchange Google authorization code"
            )

        tokens = res.json()
        google_access_token = tokens.get("access_token")

        userinfo_url = "https://www.googleapis.com/oauth2/v3/userinfo"
        headers = {"Authorization": f"Bearer {google_access_token}"}
        userinfo_res = httpx.get(userinfo_url, headers=headers)
        if userinfo_res.status_code != 200:
            raise HTTPException(
                status_code=400, detail="Failed to retrieve Google user profile"
            )

        profile = userinfo_res.json()
        email = profile.get("email")
        name = profile.get("name")

    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email")

    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(
            email=email,
            name=name,
            hashed_password=get_password_hash(str(uuid.uuid4())),
            is_verified=True,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    elif not user.is_verified:
        user.is_verified = True
        db.commit()

    db.commit()

    jti = str(uuid.uuid4())
    device_id = "google_oauth_device"
    device_name = request.headers.get("user-agent", "Unknown Device")
    ip_address = request.client.host if request.client else "127.0.0.1"

    db_session = UserSession(
        user_id=user.id,
        device_id=device_id,
        device_name=device_name,
        ip_address=ip_address,
        token_jti=jti,
        is_active=True,
    )
    db.add(db_session)
    db.commit()

    token = create_access_token({"sub": user.email, "jti": jti, "device_id": device_id})
    return {"access_token": token, "token_type": "bearer"}


def reassign_tasks_for_deleted_user(user_id: int, db: Session):
    from core.database import Task, Project, WorkspaceMembership
    from services.algorithms import workload_balancer

    # Get all tasks assigned to the user
    user_tasks = (
        db.query(Task).filter(Task.assignee_id == user_id, Task.status != "Done").all()
    )

    # Group tasks by workspace_id
    workspace_tasks = {}
    for t in user_tasks:
        ws_id = t.project.workspace_id
        if ws_id not in workspace_tasks:
            workspace_tasks[ws_id] = []
        workspace_tasks[ws_id].append(t)

    for ws_id, tasks in workspace_tasks.items():
        # Get all other members in this workspace
        members = (
            db.query(WorkspaceMembership)
            .filter(
                WorkspaceMembership.workspace_id == ws_id,
                WorkspaceMembership.user_id != user_id,
                WorkspaceMembership.status == "joined",
            )
            .all()
        )

        if not members:
            # If no other members, leave tasks unassigned
            for t in tasks:
                t.assignee_id = None
            continue

        # Build workload dict
        users_workloads = []
        for m in members:
            # get their active tasks
            m_tasks = (
                db.query(Task)
                .join(Project)
                .filter(
                    Task.assignee_id == m.user_id,
                    Project.workspace_id == ws_id,
                    Task.status != "Done",
                )
                .all()
            )

            task_list = [
                {"priority": mt.priority_level, "due_date": mt.due_date}
                for mt in m_tasks
            ]
            users_workloads.append({"user_id": m.user_id, "tasks": task_list})

        # Reassign
        for t in tasks:
            best_user_id = workload_balancer(users_workloads)
            if best_user_id:
                t.assignee_id = best_user_id
                t.reassignment_reason = (
                    "Automatically reassigned due to account deletion."
                )
                # update the workload list for the next iteration
                for uw in users_workloads:
                    if uw["user_id"] == best_user_id:
                        uw["tasks"].append(
                            {"priority": t.priority_level, "due_date": t.due_date}
                        )
                        break
            else:
                t.assignee_id = None
    db.commit()


@router.post("/deletion-otp")
def request_deletion_otp(
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    otp = f"{random.randint(100000, 999999)}"
    current_user.deletion_otp = otp
    current_user.deletion_otp_expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=15
    )
    db.commit()

    msg = f"Your Orbit account deletion authorization code is: {otp}. It will expire in 15 minutes."
    background_tasks.add_task(
        send_notification_email,
        to_email=current_user.email,
        subject="Authorize Account Deletion",
        body=msg,
    )
    return {"status": "success", "message": "Deletion OTP sent successfully"}


@router.post("/schedule-deletion")
def schedule_deletion(
    payload: schemas.DeletionScheduleRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    token: str = Depends(oauth2_scheme),
):
    # Cooldown check
    now = datetime.now(timezone.utc)
    if current_user.last_deletion_attempt_at:
        attempt = current_user.last_deletion_attempt_at
        if attempt.tzinfo is None:
            attempt = attempt.replace(tzinfo=timezone.utc)
        if (now - attempt).days < 30:
            raise HTTPException(
                status_code=400,
                detail="You cannot apply for account deletion within 30 days of a previous attempt.",
            )

    # Verify password OR OTP
    # Detect OAuth users: they were created with a random UUID password they don't know.
    # We check if they registered via Google OAuth by looking for the google_oauth_device session.

    if payload.otp:
        # Verify OTP
        if not current_user.deletion_otp or current_user.deletion_otp != payload.otp:
            raise HTTPException(status_code=400, detail="Invalid deletion OTP")
        expiry = current_user.deletion_otp_expires_at
        if expiry and expiry.tzinfo is None:
            expiry = expiry.replace(tzinfo=timezone.utc)
        if expiry and expiry < now:
            raise HTTPException(status_code=400, detail="Deletion OTP has expired")
    elif payload.password:
        # Verify password
        if not verify_password(payload.password, current_user.hashed_password):
            raise HTTPException(status_code=400, detail="Incorrect password")
    else:
        raise HTTPException(status_code=400, detail="Password or OTP is required")

    # Schedule deletion
    current_user.deletion_scheduled_at = now
    current_user.last_deletion_attempt_at = now
    current_user.deletion_otp = None
    current_user.deletion_otp_expires_at = None
    db.commit()

    # Reassign tasks
    reassign_tasks_for_deleted_user(current_user.id, db)

    # Log user out
    try:
        jwt_payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        jti = jwt_payload.get("jti")
        if jti:
            db.query(UserSession).filter_by(token_jti=jti).update(
                {"is_active": False, "logout_at": now}
            )
            db.commit()
    except jwt.InvalidTokenError:
        pass

    # Send email
    msg = (
        "Your Orbit account has been scheduled for deletion and will be permanently deleted in 30 days. "
        "If you change your mind, simply log in to your account at any time during this 30-day window to revoke the deletion."
    )
    background_tasks.add_task(
        send_notification_email,
        to_email=current_user.email,
        subject="Orbit Account Scheduled for Deletion",
        body=msg,
    )
    return {"status": "success", "message": "Account scheduled for deletion"}


@router.post("/revoke-deletion")
def revoke_deletion(
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    if not current_user.deletion_scheduled_at:
        raise HTTPException(
            status_code=400, detail="Account is not scheduled for deletion"
        )

    current_user.deletion_scheduled_at = None
    current_user.last_deletion_attempt_at = None
    db.commit()
    return {"status": "success", "message": "Account deletion revoked successfully"}

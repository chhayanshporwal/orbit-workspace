from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db, User, Notification
from core.security import get_current_user
from models import schemas

router = APIRouter()


@router.get("/notifications", response_model=List[schemas.NotificationResponse])
def get_user_notifications(
    skip: int = Query(0, ge=0, description="Pagination offset"),
    limit: int = Query(50, ge=1, le=200, description="Pagination limit"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return (
        db.query(Notification)
        .filter_by(user_id=current_user.id)
        .order_by(Notification.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )


@router.put(
    "/notifications/{notif_id}/read", response_model=schemas.NotificationResponse
)
def mark_notification_read(
    notif_id: int,
    action: str = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    notif = (
        db.query(Notification).filter_by(id=notif_id, user_id=current_user.id).first()
    )
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")

    notif.is_read = True
    if action:
        suffix = f" ({action.capitalize()})"
        if not notif.message.endswith(suffix):
            notif.message = notif.message + suffix

    db.commit()
    db.refresh(notif)
    return notif

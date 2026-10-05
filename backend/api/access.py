"""Browser workspace authentication and exact-image capabilities."""

import hashlib
import hmac
import re
import secrets
import time
from pathlib import Path, PurePosixPath
from urllib.parse import urlencode

from fastapi import APIRouter, Header, HTTPException
from fastapi.responses import JSONResponse
from sqlalchemy import select

from backend.app.models import Audit, Workspace
from . import store

router = APIRouter()


@router.post("/api/v1/sessions", status_code=201)
def create_session():
    token = secrets.token_urlsafe(32)
    workspace = Workspace(id=secrets.token_hex(16), token_hash=hashlib.sha256(token.encode()).hexdigest())
    with store.SessionLocal() as session:
        session.add(workspace)
        session.commit()
    return JSONResponse({"token": token}, status_code=201, headers={"Cache-Control": "no-store"})


def require_owner(authorization: str | None = Header(default=None)) -> str:
    if not authorization or not re.fullmatch(r"Bearer [A-Za-z0-9_-]{43}", authorization):
        raise HTTPException(401, "작업공간 인증이 필요합니다.")
    digest = hashlib.sha256(authorization[7:].encode()).hexdigest()
    with store.SessionLocal() as session:
        owner = session.scalar(select(Workspace.id).where(Workspace.token_hash == digest))
    if owner is None:
        raise HTTPException(401, "작업공간 인증을 확인할 수 없습니다. 기존 브라우저의 접근 키를 확인해 주세요.")
    return owner


def image_relative_path(value: str) -> str:
    if not value.startswith("/artifacts/"):
        raise ValueError("Not an artifact image")
    relative = value.removeprefix("/artifacts/")
    parts = relative.split("/")
    if (len(parts) < 2 or parts[0] not in {"uploads", "captures", "figma", "android"}
            or any(part in {"", ".", ".."} for part in parts)
            or "\\" in relative or "?" in relative or "#" in relative
            or PurePosixPath(relative).suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}):
        raise ValueError("Not an artifact image")
    return relative


def _signature(audit: Audit, relative: str, expires: int) -> str:
    value = f"{audit.id}\n{relative}\n{expires}".encode()
    return hmac.new(audit.artifact_secret.encode(), value, hashlib.sha256).hexdigest()


def sign_image(audit: Audit, value: str) -> str:
    if not value or not value.startswith("/artifacts/"):
        return value
    try:
        relative = image_relative_path(value)
    except ValueError:
        return ""  # Legacy paths outside the image roots are deliberately not published.
    if not audit.owner_id or not audit.artifact_secret:
        return ""
    expires = (int(time.time()) // 86400 + 1) * 86400
    return value + "?" + urlencode({"audit": f"audit-{audit.id}", "expires": expires,
                                   "signature": _signature(audit, relative, expires)})


def authorized_image(directory: Path, relative: str, audit_id: str, expires: int, signature: str) -> Path:
    try:
        relative = image_relative_path("/artifacts/" + relative)
        if expires < time.time() or expires > time.time() + 86400:
            raise ValueError("Expired image")
        with store.SessionLocal() as session:
            audit = store.get_audit(session, audit_id)
            if not audit.owner_id or not audit.artifact_secret or not hmac.compare_digest(
                _signature(audit, relative, expires), signature
            ):
                raise ValueError("Invalid image capability")
        path = directory / relative
        if any(parent.is_symlink() for parent in [path, *path.parents] if parent != directory.parent):
            raise ValueError("Symlink image")
        path.resolve().relative_to(directory.resolve())
        if not path.is_file():
            raise ValueError("Missing image")
        return path
    except (KeyError, ValueError):
        raise HTTPException(404, "Image not found") from None

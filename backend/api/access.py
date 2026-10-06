"""Public workspace compatibility and exact-image capabilities."""

import hashlib
import hmac
import secrets
import time
from pathlib import Path, PurePosixPath
from urllib.parse import urlencode

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from backend.app.models import Audit
from . import store

router = APIRouter()


@router.post("/api/v1/sessions", status_code=201)
def create_session():
    # Older frontend bundles still bootstrap a token. All requests now use the
    # public workspace, so no browser identity needs to be stored or validated.
    token = secrets.token_urlsafe(32)
    return JSONResponse({"token": token}, status_code=201, headers={"Cache-Control": "no-store"})


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
    if not audit.artifact_secret:
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
            if not audit.artifact_secret or not hmac.compare_digest(
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

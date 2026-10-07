"""삭제 보호 진단 목록.

평가자가 함께 보는 대표 데모 진단만 화면·API 삭제를 막는다. 목록은 환경 변수
`PROTECTED_AUDIT_IDS`(쉼표 구분, 예: `audit-47`)로 받고 기본값은 비어 있어
모든 진단을 지울 수 있다. 요청마다 읽으므로 테스트에서 환경 변수만 바꾸면 된다.
"""

from __future__ import annotations

import os

ENV_KEY = "PROTECTED_AUDIT_IDS"
PROTECTED_MESSAGE = "대표 데모 진단은 삭제할 수 없습니다."


def _normalize(audit_id: str) -> str:
    value = audit_id.strip()
    return f"audit-{value}" if value.isdigit() else value


def protected_audit_ids() -> frozenset[str]:
    raw = os.getenv(ENV_KEY, "")
    return frozenset(_normalize(item) for item in raw.split(",") if item.strip())


def is_protected_audit(audit_id: str) -> bool:
    return _normalize(audit_id) in protected_audit_ids()

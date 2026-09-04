"""
프론트 호환성 게이트
------------------
필드 추가는 안전하지만 **enum 값 추가는 안전하지 않다.**

프론트에는 TypeScript 타입과 Zod enum 검증이 따로 있으므로, 백엔드가
`severity: "LOW"` 나 `ruleId: "DA-07"` 을 내보내는 순간 응답 파싱이 실패한다.
필드는 optional 로 추가하면 무시되지만 enum 값은 검증에 걸린다.

그래서 노출 가능한 값을 여기서 통제한다.

    FRONTEND_CONTRACT = "v2"   프론트 타입 배포 완료. 전체 개방 (기본값)
    FRONTEND_CONTRACT = "v1"   롤백 시 기존 값만 내보낸다

프론트 타입·Zod 스키마가 전체 enum 을 지원하므로 기본 계약은 v2 다.
호환성 롤백이 필요할 때만 환경변수를 v1 로 지정한다.

이 파일이 없으면 "언제 열지"가 코드 곳곳에 흩어져 추적이 어려워진다.
"""

from __future__ import annotations

import os

CONTRACT = os.getenv("DARKAUDIT_FRONTEND_CONTRACT", "v2")

# 프론트 v1 타입이 아는 값
V1_RULE_IDS = {"DA-03", "DA-04", "DA-12", "DA-15"}
V1_SEVERITIES = {"HIGH", "REVIEW"}

# severity 를 v1 범위로 눌러 담을 때의 대체값.
# LOW 는 REVIEW 로 올린다. 낮춰서 숨기는 것보다 검토 대상으로 남기는 쪽이 안전하다.
SEVERITY_FALLBACK = {"LOW": "REVIEW"}


def is_open() -> bool:
    return CONTRACT != "v1"


def allowed_rule_ids() -> set[str] | None:
    """None 이면 제한 없음."""
    return None if is_open() else set(V1_RULE_IDS)


def clamp_severity(severity: str) -> str:
    """프론트가 모르는 severity 를 아는 값으로 눌러 담는다."""
    if is_open() or severity in V1_SEVERITIES:
        return severity
    return SEVERITY_FALLBACK.get(severity, "REVIEW")


def visible(rule_id: str) -> bool:
    """이 rule_id 를 응답에 포함해도 되는지."""
    allowed = allowed_rule_ids()
    return allowed is None or rule_id in allowed


def filter_findings(findings: list) -> list:
    """
    응답 직전에 적용한다.

    v1 에서 걸러진 Finding 은 DB 에는 그대로 남는다. 노출만 막는 것이므로
    프론트 타입이 배포되면 환경변수 하나로 전부 드러난다.
    """
    if is_open():
        return findings
    out = []
    for f in findings:
        if not visible(f.ruleId):
            continue
        f.severity = clamp_severity(f.severity)
        out.append(f)
    return out


def status_note() -> dict:
    """현재 게이트 상태. /health 에 실어 배포 시 확인할 수 있게 한다."""
    return {
        "frontendContract": CONTRACT,
        "exposedRuleIds": "all" if is_open() else sorted(V1_RULE_IDS),
        "exposedSeverities": "all" if is_open() else sorted(V1_SEVERITIES),
    }

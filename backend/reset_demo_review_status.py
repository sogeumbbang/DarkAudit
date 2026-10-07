"""
데모 진단 담당자 상태 초기화 (일회성)
----------------------------------
예전에는 수정본 검사가 원본(v1) 항목의 status 에 비교 판정을 덮어썼다.
지정한 데모 진단의 원본 회차 항목 status 만 '미검토'(OPEN)로 되돌린다.
comparison_status(비교 판정)와 수정 결정 기록은 건드리지 않는다.

기본은 dry-run 이고, --apply 를 붙여야 실제로 저장한다. 저장소 루트에서 실행한다.

    python -m backend.reset_demo_review_status audit-37 audit-41
    python -m backend.reset_demo_review_status audit-37 audit-41 --apply
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass

from sqlalchemy.orm import Session

from backend.api import store
from backend.app.models import FindingStatus, RunStatus


@dataclass
class ResetPlan:
    audit_id: str
    version: int | None
    total: int
    changed: int
    error: str | None = None


def reset_demo_review_status(session: Session, audit_ids: list[str], *, apply: bool = False) -> list[ResetPlan]:
    plans: list[ResetPlan] = []
    for audit_id in audit_ids:
        try:
            audit = store.get_audit(session, audit_id)
        except KeyError:
            plans.append(ResetPlan(audit_id, None, 0, 0, "진단을 찾을 수 없습니다"))
            continue
        if not audit.demo_preset:
            plans.append(ResetPlan(audit_id, None, 0, 0, "데모 진단이 아니라 건너뜁니다"))
            continue
        done = sorted((r for r in audit.runs if r.status is RunStatus.DONE), key=lambda r: r.version)
        if not done:
            plans.append(ResetPlan(audit_id, None, 0, 0, "완료된 회차가 없습니다"))
            continue
        base = done[0]
        targets = [f for f in base.findings if f.status is not FindingStatus.OPEN]
        if apply and targets:
            for finding in targets:
                finding.status = FindingStatus.OPEN
            store.touch_audit(session, audit.id)
        plans.append(ResetPlan(audit_id, base.version, len(base.findings), len(targets)))
    if apply:
        session.commit()
    return plans


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audit_ids", nargs="+", help="초기화할 데모 진단 ID (예: audit-37)")
    parser.add_argument("--apply", action="store_true", help="실제로 저장한다. 없으면 dry-run")
    args = parser.parse_args()
    with store.SessionLocal() as session:
        plans = reset_demo_review_status(session, args.audit_ids, apply=args.apply)
    print("적용" if args.apply else "dry-run (저장하지 않음)")
    for plan in plans:
        if plan.error:
            print(f"  {plan.audit_id}: {plan.error}")
        else:
            print(f"  {plan.audit_id} v{plan.version}: 항목 {plan.total}건 중 {plan.changed}건 → 미검토")


if __name__ == "__main__":
    main()

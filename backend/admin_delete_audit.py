"""
관리용 진단 삭제
--------------
화면과 API 에서는 PROTECTED_AUDIT_IDS 에 든 대표 데모 진단을 지울 수 없다. 관리자가
진단을 서버 셸에서 정리할 때 이 스크립트를 쓴다. API·화면에는 노출하지 않는다.

기본은 dry-run 으로 대상 진단의 이름·회차·데모·보호 여부만 출력하고, --apply 를 붙여야
DB 기록과 업로드·캡처 파일, 작업 기록을 함께 지운다. 보호된 진단은 --force 까지 붙여야
지운다. 저장소 루트에서 실행한다.

    python -m backend.admin_delete_audit audit-46
    python -m backend.admin_delete_audit audit-46 --apply
    python -m backend.admin_delete_audit audit-47 --apply --force
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass, field

from sqlalchemy.orm import Session

from backend.api import jobs, service, store
from backend.api.protection import is_protected_audit


@dataclass
class DeletePlan:
    audit_id: str
    name: str = ""
    demo: bool = False
    protected: bool = False
    runs: list[str] = field(default_factory=list)
    deleted: bool = False
    error: str | None = None


def admin_delete_audits(
    session: Session, audit_ids: list[str], *, apply: bool = False, force: bool = False
) -> list[DeletePlan]:
    plans: list[DeletePlan] = []
    for audit_id in audit_ids:
        try:
            audit = store.get_audit(session, audit_id)
        except KeyError:
            plans.append(DeletePlan(audit_id, error="진단을 찾을 수 없습니다"))
            continue
        plan = DeletePlan(
            f"audit-{audit.id}",
            name=audit.name,
            demo=bool(audit.demo_preset),
            protected=is_protected_audit(f"audit-{audit.id}"),
            runs=[
                f"v{run.version} {run.status.value} · 탐지 {len(run.findings)}건"
                for run in sorted(audit.runs, key=lambda run: run.version)
            ],
        )
        if jobs.has_active(service.DATA_DIR, plan.audit_id):
            plan.error = "진행 중인 검사가 있어 건너뜁니다"
        elif plan.protected and not force:
            plan.error = "보호된 진단이라 --force 없이는 지우지 않습니다"
        elif apply:
            service.delete_audit_records(session, audit)
            plan.deleted = True
        plans.append(plan)
    return plans


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audit_ids", nargs="+", help="지울 진단 ID (예: audit-46)")
    parser.add_argument("--apply", action="store_true", help="실제로 지운다. 없으면 dry-run")
    parser.add_argument("--force", action="store_true", help="PROTECTED_AUDIT_IDS 에 든 진단도 지운다")
    args = parser.parse_args()
    with store.SessionLocal() as session:
        plans = admin_delete_audits(session, args.audit_ids, apply=args.apply, force=args.force)
    print("적용" if args.apply else "dry-run (지우지 않음)")
    for plan in plans:
        if plan.error and not plan.name:
            print(f"  {plan.audit_id}: {plan.error}")
            continue
        state = "삭제함" if plan.deleted else (plan.error or "삭제 대상")
        flags = f"데모 {'예' if plan.demo else '아니오'} · 보호 {'예' if plan.protected else '아니오'}"
        print(f"  {plan.audit_id} · {plan.name} · {flags} · {state}")
        for run in plan.runs or ["회차 없음"]:
            print(f"    {run}")


if __name__ == "__main__":
    main()

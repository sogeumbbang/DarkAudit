"""
스키마 검증 스크립트
------------------
Synthetic Dataset 의 라벨을 DB 에 적재하고 Regression 비교가 동작하는지 확인한다.

Counterfactual Pair 를 회차로 사용한다.
    v1 = risky   (문제가 있는 상태)
    v2 = clean   (수정한 상태)

기대 결과: 라벨만 적재한 회차는 검사 완료 근거가 없어 PENDING, Resolved Ratio = None

    python verify_schema.py
"""

from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app import regression
from app.fingerprint import from_label
from app.models import (
    Audit, AuditRun, Base, Element, Evidence, Finding,
    FindingRelatedElement, FlowType, RunStatus, Screen, Severity,
)

LABELS = Path(__file__).resolve().parents[1] / "data" / "synthetic" / "labels"


def load_run(session: Session, audit: Audit, doc: dict, version: int) -> AuditRun:
    """라벨 JSON 한 건을 하나의 회차로 적재한다."""
    run = AuditRun(
        audit=audit, version=version, status=RunStatus.DONE,
        note=f"{doc['flow_id']} ({doc['variant']})",
    )
    session.add(run)
    session.flush()

    # 화면과 요소
    screens: dict[int, Screen] = {}
    for sc in doc["screens"]:
        s = Screen(
            run_id=run.id,
            flow_type=FlowType(doc.get("flow_type", "join")),
            screen_index=sc["screen_index"],
            image_path=sc["image"],
            viewport_w=sc["viewport"]["width"],
            viewport_h=sc["viewport"]["height"],
        )
        session.add(s)
        screens[sc["screen_index"]] = s
    session.flush()

    def make_element(ref: dict) -> Element:
        e = Element(
            screen_id=screens[ref["screen_index"]].id,
            dom_id=ref.get("element_id"),
            element_type=ref.get("element_type"),
            text=ref.get("text"),
            bbox_x=ref["bbox"][0], bbox_y=ref["bbox"][1],
            bbox_w=ref["bbox"][2], bbox_h=ref["bbox"][3],
            source="dom",
        )
        session.add(e)
        return e

    for lb in doc["labels"]:
        primary = None
        if lb["label_unit"] == "element":
            primary = make_element(lb["primary"])
            session.flush()

        sev = Severity(lb["severity"])
        # 완화로 하향된 경우를 되돌려 base 를 기록한다.
        base = Severity.HIGH if lb.get("mitigated") and sev is Severity.REVIEW else sev

        f = Finding(
            run_id=run.id,
            rule_id=lb["rule_id"],
            label_unit=lb["label_unit"],
            fingerprint=from_label(lb),
            primary_element_id=primary.id if primary else None,
            screen_indices=lb.get("screen_indices"),
            base_severity=base,
            severity=sev,
            combination_with=lb.get("combination_with") or [],
            mitigated=bool(lb.get("mitigated")),
        )
        session.add(f)
        session.flush()

        for rel in lb.get("related_elements", []):
            re_el = make_element(rel)
            session.flush()
            session.add(FindingRelatedElement(finding_id=f.id, element_id=re_el.id))

        session.add(Evidence(
            finding_id=f.id,
            where_text=f"Screen {primary.screen_id}" if primary else "Flow 전체",
            what_text=(primary.text if primary else None),
            observation="자동 생성 라벨",
            rule_ref=lb["rule_id"],
        ))

    session.flush()
    return run


def main() -> None:
    engine = create_engine("sqlite://", future=True)
    Base.metadata.create_all(engine)
    print(f"테이블 생성: {', '.join(sorted(Base.metadata.tables))}\n")

    pairs: dict[str, dict[str, dict]] = {}
    for p in sorted(LABELS.glob("*.json")):
        d = json.loads(p.read_text(encoding="utf-8"))
        pairs.setdefault(d["pair_id"], {})[d["variant"]] = d

    ok = 0
    with Session(engine) as session:
        for pid, v in sorted(pairs.items()):
            if "risky" not in v or "clean" not in v:
                continue
            audit = Audit(name=pid, sector=v["risky"].get("sector"))
            session.add(audit)
            session.flush()

            load_run(session, audit, v["risky"], 1)
            load_run(session, audit, v["clean"], 2)
            session.commit()

            rep = regression.compare(session, audit.id, 1, 2)
            session.commit()

            s = rep.summary()
            # Labels alone do not prove that an actual inspection completed.
            passed = s["resolved_ratio"] is None and s["resolved"] == 0 and s["new"] == 0
            ok += passed
            mark = "통과" if passed else "확인필요"
            print(f"{pid:<10} resolved={s['resolved']:<2} persisted={s['persisted']:<2} "
                  f"new={s['new']:<2} pending={s['pending']:<2} ratio={str(s['resolved_ratio']):<5} {mark}")

        print(f"\nCounterfactual Regression: {ok}/{len(pairs)} 쌍 통과")

        # 완화 케이스 확인
        mit = session.query(Finding).filter(Finding.mitigated.is_(True)).all()
        for f in mit:
            print(f"완화 케이스: {f.rule_id}  base={f.base_severity.value} "
                  f"→ final={f.severity.value}  mitigated={f.mitigated}")

        # 저장 규모
        print(f"\n적재: Audit {session.query(Audit).count()} / "
              f"Run {session.query(AuditRun).count()} / "
              f"Screen {session.query(Screen).count()} / "
              f"Element {session.query(Element).count()} / "
              f"Finding {session.query(Finding).count()}")


if __name__ == "__main__":
    main()

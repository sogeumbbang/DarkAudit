## 현재 입력 모드: DOM 후보와 화면의 결합 검증

DA-04·DA-07·DA-15의 탐지는 Deterministic Candidate가 있을 때만 KEEP/REJECT로 판정한다.
새 semantic finding은 DA-03.optional_looks_mandatory 및 DA-12.loss_framed_decline/trivializing_expression에서만 만든다.
후보가 없는 규칙도 rule_assessments에 검토 상태를 기록한다. 후보가 없다는 사실만으로 미수집 상태까지 정상이라고 판단하지 않는다.
DA-07.skippable_without_confirm은 interaction_evidence=true와 실제 진행 근거가 있을 때만 KEEP한다.

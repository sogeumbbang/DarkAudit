# Rule Base ↔ AI Interface v1.2

## 입력과 역할

`rules/dark_pattern_rules.yaml`은 규칙 정의·체크·기본 심각도를 소유한다. 수집기는 화면, 정규화된 요소 좌표, 실제 선택 상태와 `profile`, `path_id`, `state_id`를 전달한다. 화면의 문구는 검사 대상 데이터이며 실행 지시로 취급하지 않는다.

모델 요청 하나는 순서가 있는 화면 1~5개다. URL의 긴 페이지는 DOM 좌표를 보존해 분할한다. 서로 다른 기기·프로토타입 분기는 별도로 분석한다. 긴 경로는 초기 화면·인접 전환을 겹쳐 배치 처리하고, 모든 단계 조합을 비교하지 못하는 한계를 알린다.

## 모델 출력

정식 계약은 `ai/schemas/audit_output.schema.json`이며 `hybrid_audit_output.schema.json`도 같은 내용이다. 입력 계약은 `audit_input.schema.json`이다. 계약 변경 시 버전과 Golden Test를 함께 갱신한다.

- `audit_id`, `schema_version: "1.2"`, `screens`: 입력 식별자를 그대로 반환한다.
- `candidate_decisions`: 전달한 모든 Rule 후보에 정확히 한 번 KEEP/REJECT를 응답한다. KEEP 신뢰도는 0.70 이상이어야 한다.
- `semantic_findings`: `where`, `bbox`, `related_elements`, `what`, `observation`, `rule_id`, `why`, `severity`, `confidence`, `fix`를 포함한다.
- `rule_assessments`: DA-03·04·07·12·15 각각 정확히 한 항목. 모든 입력 화면 ID, 사유, 해당 규칙의 `checks`, `choice_pairs`, `price_comparisons`를 포함한다.

검사 상태는 `detected`, `not_detected`, `insufficient_evidence`, `not_supported`다. 탐지/KEEP 유무와 상태가 일치해야 한다. 빈 Finding만으로 정상 판정을 의미하지 않는다. 구형 테스트 provider의 검사 상태 누락은 경고와 함께 미완료로 표시한다. 실제 OpenAI 응답에는 상태를 필수로 요구한다.

## 입력별 판정 범위

DOM이 있는 URL은 Rule Engine 후보를 검증하고, 새로운 의미 Finding은 DA-03·12만 허용한다. DOM 수집 실패와 이미지/Figma/APK 경로는 시각 모드로 5개 MVP 규칙을 판단한다. 일반 프롬프트는 `audit_v1.md`, 모드별 지시는 `dom.md`와 `visual.md`다.

DA-03은 실제 수락/거절 동작과 라벨을 `choice_pairs`에 명시하고 약화된 선택지를 `related_elements`로 연결한다. 경고 문단만으로 선택지 쌍을 만들지 않는다. DA-12는 독립적으로 감정적 문구를 검사한다.

DA-15는 같은 상품·기기·경로의 다른 상태를 시간순으로 비교한다. 상품, 이전/최종 화면, 금액, 단위(KRW/percent), 사용자 선택에 의한 변화 여부, 최초 고지 여부를 구조화한다. 원화 증가 또는 예적금 이율 하락을 검증한다. 최초 근거는 관련 요소, 최종 근거는 주 bbox이며 KEEP도 원래 후보의 근거 화면과 일치해야 한다. 동일 상태의 페이지 조각은 시간 변화 근거가 아니다.

## 좌표·실패·노출

bbox는 `[x, y, width, height]`의 화면 정규화 좌표다. 선택 컨트롤/강조 CTA는 확대 이미지의 후보 ID로 위치를 재검증한다. 검증 실패 시 원래 좌표를 유지하고 경고한다.

계약 오류는 제한된 횟수만 재요청한다. 특정 규칙의 증거 계약을 끝내 만족하지 못하면 그 규칙을 미완료로 표시하고 다른 유효 판정을 보존한다. 기본 심각도는 DA-03·04·07·15 HIGH, DA-12 REVIEW이며 결합 계산은 후단에서 수행한다.

API `analysisSummary`에는 배치별 모델·토큰 사용량·검사 상태·수집 및 좌표 검증 한계가 보존된다. 한 배치가 미완료이면 다른 배치에서 탐지했어도 전체를 완료로 표시하지 않는다. Fake provider 결과는 모의 분석이다. 지원 규칙은 15개 중 5개이며 전체 유형 검사를 의미하지 않는다.

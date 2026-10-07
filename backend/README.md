# Backend

## 구조

```
app/
  models.py       SQLAlchemy 데이터 모델
  fingerprint.py  회차 간 Finding 매칭 키 생성
  regression.py   Before/After 비교 로직
verify_schema.py  라벨 적재 + Regression 동작 검증
test_fingerprint.py  fingerprint 견고성 테스트
```

## 데이터 모델

```
Audit                감사 세션 (금융상품 Flow 하나)
 └ AuditRun          회차 (v1 = 최초, v2 = 수정 후)
    ├ Screen         화면 (순서, flow_type)
    │  └ Element     UI 요소 — 전부 저장
    └ Finding        탐지된 위험
       ├ FindingRelatedElement   관계 구성 요소
       └ Evidence                WHERE/WHAT/OBSERVATION/RULE/WHY/FIX
```

### 설계 결정

**AuditRun 을 Audit 과 분리한다.** 화면을 Audit 에 직접 매달면 v1/v2 구분이 불가능해
Before/After 비교가 지저분해진다. 회차를 분리하면 조인 한 번으로 비교된다.

**Element 를 전부 저장한다.** Finding 에 걸린 것만 남기면 임계값을 바꿀 때마다 화면을
다시 올려야 한다. 전체를 보관하면 재계산만으로 결과를 갱신할 수 있다.

**결합 판정 근거는 `Finding.combination_with` 배열에 둔다.** 별도 관계 테이블 대신
배열을 쓴다. label_schema.json 이 이미 같은 형태이고, 조회가 "이 Finding 이 왜
승격됐나" 방향에 집중되어 있다.

**base_severity 와 severity 를 함께 저장한다.** Rule Base 기본값과 최종값을 모두
남겨야 왜 승격·하향됐는지 추적할 수 있다.

## Fingerprint

v1 과 v2 의 Finding 을 "같은 문제"로 잇는 키. Regression Audit 의 전제 조건이다.

**느슨하게(loose) 설계했다.** 빡빡하게 잡으면 문구를 조금만 다듬어도
"기존 문제 해결 + 새 문제 발생"으로 보고된다. 담당자 입장에서는 고쳤는데 새 문제가
생겼다고 나오는 셈이라 신뢰가 깨진다.

무시하는 것:

| 대상 | 처리 | 이유 |
| --- | --- | --- |
| 정확한 좌표 | 0.1 단위 격자로 반올림 | 레이아웃 미세 조정에 견디도록 |
| 숫자 | 자릿수 무관하게 `#` 하나로 | 9,900 → 12,900 이 다른 문제가 되면 안 됨 |
| 공백·문장부호 | 제거 | 문구 정리에 견디도록 |

유지하는 것: `rule_id`, `screen_index`. 이것까지 뭉개면 서로 다른 화면의 다른 규칙이 섞인다.

`label_unit` 이 `flow` 인 경우 위치가 없으므로 `rule_id` 만으로 식별한다. 화면이
추가·삭제되어도 동일 문제로 추적되어야 하기 때문이다.

## 검증

### 재검증 판정 보류

비교 대상 두 회차가 지원 규칙 검사를 완료하고, 분석 화면 수와 화면 순서·단계·경로가
같을 때만 사라진 Finding을 해결로 판정합니다. 근거 부족, 수집 누락, 모의 분석,
검사 요약이 없는 이전 결과는 보수적으로 판정을 보류합니다.

`GET /api/v1/audits/{id}/regression`은 읽기만 수행합니다. 불완전한 비교는
`comparisonStatus: "incomplete"`, `pending`, `limitations`를 반환하고, 해결률은 보류
항목을 뺀 나머지로 계산합니다. 다시 검증한 항목이 하나도 없으면 `resolvedRatio: null`입니다.
규칙을 특정하는 경고(`evidence_contract:DA-xx`, 규칙이 기록된 `semantic_findings_dropped`)는
해당 규칙만 보류합니다. `null`을 해결률 0%로 표시하지 마세요. 분석 완료 시 저장된 보류 사유는
결과 화면과 PDF에도 표시됩니다. 화면의 의미적 대응이나 규칙 버전 비교까지 보장하는
기능은 아니며, 화면 구성이 바뀐 경우에는 수동 확인이 필요합니다.

### 정상 화면 오탐 회귀 검사

저장소 루트에서 실행합니다. `ai/evaluation/clean_cases.json`은 기존 정상 Flow 11개와
라벨 해시를 고정합니다. 일반 평가 보고서에도 `clean_regression` 집계가 추가됩니다.

이미 저장한 회차별 예측 결과를 비용 없이 집계하려면:

```bash
python -m ai.evaluation.clean_regression --predictions docs/eval/hybrid_visual/run-1
```

출력은 오탐 Finding 수, 오탐 Flow 수, 규칙별 FPR, 분석 실패 수, 검사 미완료 수를
구분합니다. 예측 파일 누락·실패·모의 분석은 정상 판정으로 세지 않으며, 규칙 검사
기록이 없거나 근거가 부족한 빈 결과도 통과하지 않습니다. 기본 통과 기준은 오탐·실패·
미완료 모두 0이고, 초과 시 종료 코드 1을 반환합니다. 합의된 기준선이 있으면
`--max-false-positive-findings N`과 `--max-analysis-failures N`으로 한도를 지정합니다.
FPR 분모는 판정 가능한 `(Flow, 규칙)` 쌍이며 미판정 수를 함께 확인해야 합니다.

합성 화면을 생성한 환경에서 새 모델 출력을 측정하려면 다음 명령을 사용합니다.
이 명령은 실제 모델 API를 호출하므로 비용이 발생합니다.

```bash
python -m backend.eval_hybrid --clean-only --visual --runs 1 --output-dir /tmp/darkaudit-clean-new
python -m ai.evaluation.clean_regression --predictions /tmp/darkaudit-clean-new/run-1
```

출력 디렉터리는 비어 있어야 합니다. `--clean-only`에서 경로를 생략하면 매번 새 경로를
만들어 과거 예측 재사용을 방지합니다. 정상 사례만으로 재현율을 판단할 수 없으므로,
탐지 조건을 변경했다면 기존 Risky/Clean 전체 평가도 실행해야 합니다.
CI 단위테스트는 고정 목록과 집계·실패 판정을 검증하며 실제 모델 성능을 측정하지 않습니다.

```bash
pip install sqlalchemy
python test_fingerprint.py   # fingerprint 견고성
python verify_schema.py      # 라벨 적재 + Regression
```

`verify_schema.py` 는 Counterfactual Pair 를 회차로 사용한다(risky = v1, clean = v2).
라벨 적재만으로 검사 완료를 입증할 수 없어 해결 판정이 보류되는지 확인합니다.
정상 검사 후 해결·재발 판정은 `backend/tests/test_regression_regressed.py`에서,
문구·좌표 변화에 대한 매칭은 `test_fingerprint.py`에서 다룹니다.

## 알려진 한계

현재 라벨 파일에는 Finding 에 걸린 요소만 들어 있어 `verify_schema.py` 로 적재하면
Element 가 26건에 그친다. 모델은 전체 저장을 전제하므로, 실제 파이프라인에서는
파싱 단계에서 화면의 모든 요소를 넘겨받아야 한다.

## Rule Engine

```
app/rule_engine/
  core.py       체크 레지스트리, 입력 자료구조, Rule Base 로더
  checks.py     deterministic check 구현
  severity.py   severity 계산 (standalone / combination / mitigation)
eval_rule_engine.py   정답 라벨 대조 평가
```

### 규칙 데이터와 코드를 잇는 방식

Rule Base 의 check 는 `area_ratio >= 1.5` 같은 **설명 문자열**이지 실행 코드가 아니다.
둘을 잇는 방법은 두 가지다.

| 방식 | 장점 | 단점 |
| --- | --- | --- |
| YAML 에 표현식을 넣고 eval | 데이터만 고쳐 규칙 변경 | 복잡한 로직 표현 불가, 디버깅 난해 |
| **check_id → 함수 매핑** | 명확하고 테스트 가능 | 코드 수정 필요 |

후자를 택했다. "대립하는 선택지 쌍을 찾아 비교" 같은 체크는 표현식으로 쓸 수 없다.
**임계값만 YAML 에서 읽어** 코드와 데이터의 역할을 나눈다.

YAML 에 선언됐으나 구현되지 않은 check 는 조용히 탐지 누락으로 이어지므로
`audit_coverage()` 가 미구현 목록을 드러낸다.

### 평가 결과 (deterministic 단독)

| rule | P | R | F1 |
| --- | --- | --- | --- |
| DA-03 | 1.00 | 1.00 | 1.00 |
| DA-04 | 0.18 | 1.00 | 0.31 |
| DA-07 | 0.15 | 1.00 | 0.25 |
| DA-12 | 1.00 | 1.00 | 1.00 |
| DA-13 | 1.00 | 1.00 | 1.00 |
| DA-15 | 0.50 | 1.00 | 0.67 |
| **micro** | **0.27** | **1.00** | **0.43** |

**Recall 이 높고 Precision 이 낮은 것이 의도한 결과다.** 이 단계의 역할은
후보를 넓게 잡는 것이며, 의미 판단은 Multimodal LLM 의 semantic_checks 가 맡는다.
여기서 Precision 이 높으면 semantic 단계가 불필요하다는 뜻이므로 파이프라인 설계를
재검토해야 한다.

DA-03 · DA-12 · DA-13 이 완전 일치인 것은 관찰 조건이 명확해 코드만으로 판정되기
때문이다. 반면 DA-07 은 "작고 흐린 텍스트"를 모두 잡지만 그것이 중요정보인지는
코드가 알 수 없다. 오탐이 집중된 지점이 곧 LLM 이 필요한 지점이다.

### Rule Engine 이 찾아낸 데이터 결함

`ins-007-risky`(DA-15 단독)에서 FN 이 발생해 확인한 결과, 4번 화면의 금액 상승이
DA-04 에 연동되어 있어 **DA-15 만 켜면 가격이 오르지 않는** 문제가 있었다.
라벨은 붙었으나 화면에는 드러나지 않는 상태였다.

라벨링 규칙서의 Gold Set 검수 항목 중 "심었으나 화면상 드러나지 않음"에 해당하며,
사람이 검수하기 전에 Rule Engine 이 먼저 발견했다. DA-15 가 자체적으로 후반부에
등장하는 비용을 만들도록 분리해 수정했다.

## 실행

```bash
pip install sqlalchemy pyyaml
python test_fingerprint.py     # fingerprint 견고성
python verify_schema.py        # 라벨 적재 + Regression
python eval_rule_engine.py     # Rule Engine 평가
```

## 분석 품질과 저장소 변경 (v1.2)

`api/service.py`는 입력별 수집 이후 공통 모델 분석·근거 저장을 수행한다. URL은 DOM Rule 후보를
함께 전달한다. Figma는 실제 `interactions[].actions[]` 전환을 분기별로 분석하고 Android는
화면 상태별 행동 이력 및 XML 근거를 보관한다.

`AuditRun.analysis_summary`에는 배치별 규칙 검사 상태, provider/model, 토큰 사용량,
수집·OCR·좌표 검증 경고가 저장된다. API `analysisSummary.complete`는 수집된 지원 범위의
검사 완료 여부이며 전체 15개 유형에 대한 안전 판정이 아니다. `Screen.analysis_context`는
기기·경로·상태·원본 근거를 보관한다. 화면/Finding과 품질 정보는 같은 회차에서 반환한다.

서버 시작 시 `store.init_db()`가 기존 DB에 누락된 두 JSON 열을 추가한다. 기존 행은 유지되며
옛 분석은 품질 정보가 비어 있다. 운영 DB를 업데이트하기 전 일반 배포 절차대로 백업한다.
재시작을 반복해도 동일 열을 중복 생성하지 않는다.

저장소 루트에서 `python -m unittest discover -s backend/tests -v`를 실행한다. 테스트마다
임시 DB·경로·환경을 격리하고, API 입력 4종의 공통 분석/DB 응답을 검증한다. 실제 Figma·
BrowserStack 연결은 별도 인증과 테스트 파일을 갖춘 환경에서 확인해야 한다.

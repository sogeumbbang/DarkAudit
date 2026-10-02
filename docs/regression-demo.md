# 재검증(Before/After) — 백엔드 API와 시연 데이터

브랜치 `feat/regression-backend`. 같은 진단(audit)에 수정본을 다시 올리면 새 회차(run)로 분석하고, 직전 회차와 비교해 **해결 / 유지 / 개선 / 신규 / 재발**과 **해결률(Resolved Finding Ratio)**을 돌려준다.

> 상태: **백엔드 완료, 프론트 미연결.** 프론트에는 재업로드·비교 화면이 없다(`/app/benchmark`는 정적 안내 카드). 프론트 구현은 `feat/regression-ui-frontend` 브랜치(태그 `backup/regression-ui-frontend-2026-10-02`)에 보관돼 있다.

## 1. 동작 방식

| 단계 | 내용 | 코드 |
| --- | --- | --- |
| 회차 생성 | 기존 audit에 `POST /screens`를 하면 `version+1`의 새 `AuditRun`이 만들어진다 | `backend/api/service.py:116-126` |
| 분석 | `POST /analyze` 완료 후 직전 완료 회차와 자동으로 `compare`를 실행하고 Finding 상태를 갱신 | `service.py:570-581` |
| 비교 조회 | `GET /audits/{id}/regression` (`from`·`to` 쿼리로 회차 지정 가능, 기본은 최신 두 완료 회차) | `backend/api/main.py:134` |
| 판정 | fingerprint(규칙·단위·화면·위치·텍스트)로 같은 문제를 맞춘다 | `backend/app/fingerprint.py`, `backend/app/regression.py` |

분류 규칙(`regression.py:113-135`)
- 이전에만 있음 → **해결**, 양쪽에 있음 → **유지**(위험도가 낮아지면 **개선**)
- 이번에만 있음 → **신규**, 단 이전 회차들에서 한 번이라도 `RESOLVED`였던 fingerprint면 **재발**
- 해결률 = 해결 ÷ (해결 + 유지 + 개선). 신규·재발은 분모에 넣지 않는다(`regression.py:55-62`).

## 2. API로 재검증하기

기본 주소는 `http://localhost:8000`(백엔드: 저장소 루트에서 `python -m uvicorn backend.api.main:app --port 8000`). 아래 예시는 펫보험 데모(원본 → 수정본)로 실제 실행한 값이다. `DARKAUDIT_PROVIDER=openai`, `DARKAUDIT_MODEL`, `OPENAI_API_KEY`가 있어야 실제 분석이 된다(`fake`면 모의 결과).

### ① 진단 생성
```bash
curl -s -X POST http://localhost:8000/api/v1/audits \
  -H 'Content-Type: application/json' \
  -d '{"name":"재검증 데모 · 모루 반려동물 보험","platform":"mobile-web","productType":"insurance"}'
```
```json
{"id":"audit-3","name":"재검증 데모 · 모루 반려동물 보험","platform":"mobile-web","productType":"insurance","status":"draft", "...": "..."}
```

### ② 1회차: 원본 화면 업로드 → 분석
```bash
cd frontend/public/sample-audit
curl -s -X POST http://localhost:8000/api/v1/audits/audit-3/screens \
  -F files=@01-product-intro.png -F files=@02-preselected-addon.png -F files=@03-consent-pressure.png \
  -F files=@04-emotional-pressure.png -F files=@05-hidden-conditions.png -F files=@06-final-price.png \
  -F 'flow_steps=보장 소개' -F 'flow_steps=특약 선택' -F 'flow_steps=개인정보 동의' \
  -F 'flow_steps=특약 재권유' -F 'flow_steps=면책 조건' -F 'flow_steps=최종 보험료'

curl -s -X POST http://localhost:8000/api/v1/audits/audit-3/analyze
```
```json
{"jobId":"job-…","auditId":"audit-3","status":"queued","progress":5.0,"runId":"run-4","error":null}
```
작업이 끝날 때까지 `GET /api/v1/analysis-jobs/{jobId}`를 반복한다(`status`: `queued` → `analyzing` → `completed`/`failed`, 이번 데모는 약 1.5~2분).

이 시점에 `GET /regression`을 호출하면 이전 회차가 없어 **409**다.
```json
{"detail":"비교할 이전 회차가 없습니다. 재진단 후 다시 시도해주세요."}
```

### ③ 2회차: 수정본 화면 업로드 → 분석 (같은 audit)
같은 `POST /screens`, `POST /analyze`를 수정본 파일(`demo/sample-audit-revised/`)로 다시 호출한다. 응답의 `runId`가 `run-5`처럼 새 회차로 바뀐다. `GET /dashboard/summary`의 해당 audit에서 `runs[]`에 `version` 1·2가 보인다.
```bash
cd demo/sample-audit-revised   # 같은 방식으로 6장 업로드 후 /analyze
```

### ④ 비교 조회
```bash
curl -s http://localhost:8000/api/v1/audits/audit-3/regression
# 회차 지정: ...?from=1&to=2
```
실제 응답(전체는 `docs/eval/regression-demo-audit3.json`):
```json
{
  "auditId": "audit-3",
  "fromVersion": 1,
  "toVersion": 2,
  "resolved": [
    {"ruleId": "DA-04", "findingId": "finding-15", "before": "HIGH", "after": null},
    {"ruleId": "DA-04", "findingId": "finding-16", "before": "HIGH", "after": null},
    {"ruleId": "DA-04", "findingId": "finding-17", "before": "HIGH", "after": null},
    {"ruleId": "DA-07", "findingId": "finding-20", "before": "HIGH", "after": null},
    {"ruleId": "DA-15", "findingId": "finding-22", "before": "HIGH", "after": null}
  ],
  "improved":  [{"ruleId": "DA-12", "findingId": "finding-24", "before": "HIGH", "after": "REVIEW"}],
  "persisted": [{"ruleId": "DA-07", "findingId": "finding-23", "before": "HIGH", "after": "HIGH"}],
  "new": [],
  "regressed": [],
  "resolvedRatio": 0.714
}
```
- `findingId`: 해결 항목은 **이전 회차**의 finding, 나머지는 **현재 회차**의 finding을 가리킨다(`backend/api/store.py:307-342`).
- 오류: 이전 회차 없음 `409`, audit 없음 또는 지정한 회차가 없음/미완료 `404`.
- 주의: `GET /regression`은 호출 때마다 `compare`를 다시 실행해 `Finding.status`(해결/재발)를 갱신한다(`main.py:159-166` 주석). 결과는 결정적이지만 사용자가 수동으로 바꾼 상태가 덮일 수 있다.

## 3. 시연용 데이터

### 수정본 화면 6장 (`demo/sample-audit-revised/`)
생성: `python demo/render_revised_pet.py` (Playwright + Pillow 필요). 원본 데모 페이지(`frontend/public/dark-pattern-demo`)를 그대로 쓰고 렌더링 중에 `scenarios.js` 응답에 패치를 덧붙인다(원본 데모 파일은 수정하지 않음). 원본(`frontend/public/sample-audit/`)과 같은 393×852, 2배 크기.

| 화면 | 변경 |
| --- | --- |
| 1 보장 소개 | 월 이용료 총액 12,900 → **14,000원**, 세 번째 혜택 "모바일 간편 청구"를 "**필수 계약 관리비 1,100원 포함**"으로 교체(한 줄을 더하면 852px를 넘어서 교체) — DA-15 해결 |
| 2 특약 선택 | 특약 2개와 광고 수신 동의가 모두 **미선택** — DA-04 해결 |
| 3 개인정보 동의 | 혜택 목록의 체크 모양(✓)을 점(•)으로 교체. 원본·수정본 모두 이 ✓ 를 모델이 "선택된 동의"로 읽어 DA-04로 판정했기 때문 |
| 5 면책 조건 | "선택한 특약 2개 포함" → "선택한 특약 없음 (기본형)" (특약이 없는 수정본과 모순되지 않게) |
| 6 최종 보험료 | 데모 페이지가 선택 상태로 계산: 기본 12,900 + 필수 관리비 1,100 = **14,000원** |
| 4 | 원본과 같음(DA-12 죄책감 문구, DA-03 버튼 위계 유지) |

### 사전 실행 진단 `audit-3`
| 항목 | 값 |
| --- | --- |
| audit ID | **`audit-3`** — "재검증 데모 · 모루 반려동물 보험 (원본 → 수정본)" (1회차 원본, 2회차 수정본) |
| 비교 조회 | `GET /api/v1/audits/audit-3/regression` (응답: `docs/eval/regression-demo-audit3.json`) |
| 저장 위치 | `data/darkaudit.db`, `data/uploads/audit-3/` — gitignore 대상. 시연 PC로 옮기려면 두 경로를 복사 |
| 분석 조건 | gpt-5.6-luna, OCR 켬, DA-15 가격 비교 프롬프트 변경 후 |
| 별도 진단 | `audit-1`(펫보험 사전 실행, 재검증 없음)은 변경 없음 |

결과 해석: 해결률 **71%(7건 중 5건 해결)**. DA-04(×3, 모델이 같은 문제를 3건으로 냄)와 **DA-15**가 해결로 나오는 것은 의도대로다. **DA-07 해결 1건은 수정하지 않은 화면에 대한 모델 판정 변동**이다(원본에서 두 곳을 지목했고 수정본에서는 한 곳만 지목). "수정한 것만 해결됐다"고 단정하면 안 된다.

## 4. 실제 LLM 검증 기록 (gpt-5.6-luna, 복사본 DB, 상한 $0.3 → 실제 약 $0.297)

| 실행 | 결과 |
| --- | --- |
| 복사본 DB 1회(수정본 3단계 수정 전) | 해결: **DA-04, DA-15**, DA-03(수정하지 않은 화면, 모델 변동) / 신규: DA-04(3단계 ✓ 오인) / 유지: DA-07·DA-12 / 해결률 0.5 |
| 저장소 DB, 3단계 수정 전 시도 3회 | DA-04·DA-15 해결은 매번 재현. 3단계 DA-04가 유지로 남음 → 수정본 3단계를 고침 |
| 저장소 DB, 3단계 수정 후 → **audit-3** | 위 "실제 응답" |

- 같은 입력이어도 실행마다 모델 판정이 달라 해결/유지 목록이 조금씩 다르다(`docs/eval-results.md` §6.3, §14). 시연·발표 부록은 사전 실행 진단(`audit-3`)의 저장된 응답을 쓰고 라이브 재분석은 보조로 둔다.
- 시도한 진단 중 `audit-3`만 남기고 나머지(중간 시도·미완료 1건)는 삭제했다.

## 5. 테스트

`backend/tests/test_regression_regressed.py` (재발 판정, API 수준 3개)
- v1 발견 → v2 해결 → v3 같은 문제 재등장 ⇒ **재발**(`regressed`), 신규 아님, 해결률 분모에 미포함
- v3 이후에도 최신 회차 finding 유지
- 한 번도 해결된 적 없는 문제가 v2에 처음 생기면 **신규**

기존 `test_api.py`의 `test_regression_endpoint_reports_resolved_finding_across_runs`는 해결·409·404 경로를 검증한다.

## 6. 남은 한계
- **프론트 미연결**: 재업로드 버튼·비교 화면 없음(위 보관 브랜치 참고).
- 사용자가 수동으로 "해결됨"으로 바꾼 상태가 재발 판정에 섞일 수 있다(`PATCH /findings/{id}` → `RESOLVED` 저장). 이번 테스트는 모델 결과 기준의 재발만 검증한다.
- 비교는 최신 두 회차가 기본이다. `from`/`to`로 건너뛴 회차를 지정하면 재발 판정 기준이 달라질 수 있다.

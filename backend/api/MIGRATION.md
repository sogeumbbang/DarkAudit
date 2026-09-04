# 백엔드 통합 진행 상황

Team A 가 만든 API 계층을 Team B 가 이어받아 DB 기반으로 교체하는 작업.
**API 엔드포인트와 기존 DTO 필드는 유지하고 내부만 바꾼다.**

## 합의 내용 (2026-08-31)

- 백엔드 담당은 Team B 로 이관
- API 계약 유지, `AuditDto.findings` 에는 최신 완료 Run 의 결과를 노출
- `Audit 1:N AuditRun`, `AuditRun 1:N Finding` 구조
- Rule Engine 을 LLM 앞단 후보 생성 단계로 배치
- 새 필드는 모두 optional 또는 기본값
- 프론트 타입과 Zod 스키마가 전체 ruleId 및 `LOW`를 지원하므로 기본 계약은 `v2`

## 파일 상태

| 파일 | 상태 | 비고 |
| --- | --- | --- |
| `api/schemas.py` | 수정 완료 | Team A 원본에 필드 추가. 기존 필드 무변경 |
| `api/compat.py` | 신규 | 프론트 호환 게이트 |
| `api/store.py` | 신규 | DB 저장소 + DTO 변환 |
| `api/service.py` | **미착수** | Team A 원본 유지. Run 생성·Rule Engine 연결 필요 |
| `api/main.py` | **미착수** | Team A 원본 유지. 엔드포인트 배선 필요 |
| `api/storage.py` | **제거 예정** | store.py 로 대체. service 교체 후 삭제 |

`service.py` · `main.py` · `storage.py` · `finding_mapper.py` 는 Team A 원본을 그대로
둔다. 아직 새 저장소와 배선되지 않았으므로 **현 상태로는 새 코드가 동작하지 않는다.**
다음 단계에서 교체한다.

## 남은 작업

1. **`service.py` 교체**
   - `create_audit` / `save_screens` 를 DB 기반으로
   - `create_job` 이 `AuditRun` 을 생성하도록 (재분석 시 version 증가)
   - `run_analysis` 에 Rule Engine 단계 추가 → LLM 검증 → severity 계산 → Finding 저장
   - 백그라운드 작업의 세션 관리

2. **`main.py` 배선**
   - 기존 엔드포인트를 새 store 로 연결
   - `GET /api/v1/audits/{id}/regression` 추가
   - `/health` 에 `compat.status_note()` 노출

3. **정리**
   - `storage.py` · `finding_mapper.py` 삭제
   - 통합 테스트를 DB 기반으로 갱신

4. **경로 조작 취약점 수정**
   `save_screens` 에서 `screen_id` 가 검증 없이 파일명에 들어간다.
   `screen_id="../../../x"` 로 디렉토리를 벗어날 수 있다.

## 확인 필요 — import 경로

Team A 코드는 `from backend.schemas import ...` 를 쓰고, Team B 코드는
`from app.models import ...` 를 쓴다. 두 트리를 합칠 때 패키지 루트를 정해야 한다.

제안: 저장소 루트에 `backend/` 를 두고 그 아래를 다음과 같이 구성한다.

```
backend/
  api/          FastAPI 계층 (main, service, schemas, compat, store)
  app/          도메인 (models, fingerprint, regression, rule_engine)
```

이 경우 import 는 `from backend.app.models import ...` 가 된다.
현재 코드는 `from app.models` 로 되어 있어 통합 시 일괄 수정이 필요하다.

## 프론트 계약 전환 절차

`compat.py` 가 노출 가능한 enum 값을 통제한다.

```
DARKAUDIT_FRONTEND_CONTRACT=v2   (기본) 전체 개방
DARKAUDIT_FRONTEND_CONTRACT=v1          롤백 시 DA-03/04/12/15, HIGH/REVIEW 만 노출
```

프론트 TypeScript 타입과 Zod 스키마 전환이 완료되어 백엔드는 환경변수가 없어도
`v2`로 동작한다. 구버전 프론트로 롤백해야 할 때만 환경변수를 `v1`로 지정한다.

`v1` 에서 걸러진 Finding 도 DB 에는 그대로 저장된다. 노출만 막으므로
평가 스크립트는 게이트를 거치지 않고 전체 유형으로 성능을 측정한다.

## combinationWith 관련 조정

Team A 요청은 "같은 Run 안의 연관 findingId 목록"이었으나 필드를 둘로 나눴다.

| 필드 | 값 | 용도 |
| --- | --- | --- |
| `combinationWith` | findingId 목록 | 프론트에서 해당 Finding 으로 이동 |
| `combinationRules` | rule_id 목록 | 정답 라벨과 대조하는 평가 |

정답 라벨에는 findingId 가 없으므로 평가 시 rule_id 단위 비교가 필요하다.
라벨 스키마(`rules/label_schema.json`)도 rule_id 기준으로 정의되어 있다.

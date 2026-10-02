# 재검증(Before/After) 시연 가이드

브랜치 `feat/regression-ui`. 같은 진단에 수정본을 다시 올려 이전 회차와 비교하는 기능의 화면·시연용 데이터·검증 결과를 정리한다.

## 1. 구현 범위

| 항목 | 위치 |
| --- | --- |
| "수정본 다시 올리기" 버튼(진단 상세 헤더) | `frontend/src/pages/overview/OverviewPage.tsx` |
| 재업로드 모달: 기존 audit ID로 `POST /audits/{id}/screens` → `POST /analyze` → 진행률 폴링 → 완료 시 비교 화면 이동 | `frontend/src/features/regression/ReuploadDialog.tsx` |
| 비교 카드: 해결/유지/개선/신규/재발 건수, 해결률, 항목 목록(같은 규칙·위험도는 `× N`으로 묶음) | `frontend/src/features/regression/RegressionCard.tsx` |
| 비교 화면 `/app/benchmark` (진단 선택, 이전 회차 없음(409)은 "아직 재진단 기록이 없습니다") | `frontend/src/pages/regression/RegressionPage.tsx` |
| 사이드 메뉴 "비교 분석" 연결 | `frontend/src/layouts/AppLayout.tsx` |
| API 클라이언트·스키마 | `frontend/src/api/audits.ts`(`getRegression`), `frontend/src/api/schemas.ts`(`regressionSchema`) |
| MSW 핸들러·픽스처 | `frontend/src/mocks/handlers.ts`, `frontend/src/mocks/fixtures/regression.ts` |
| 테스트 | Vitest `RegressionPage.test.tsx` 3개(409 안내, 카드·목록, 재업로드→분석→비교), `AppLayout.test.tsx` 갱신. 백엔드 `backend/tests/test_regression_regressed.py` 3개(재발·신규 판정) |

검증: Vitest 73개, 백엔드 112개, ESLint·tsc 통과.

## 2. 화면만으로 끝까지 (VITE_USE_MOCKS=false)

실제 API(백엔드 `uvicorn`, MSW 꺼짐)에 연결해 브라우저(Playwright)로 따라간 결과:
`진단 상세 → 수정본 다시 올리기 → 화면 6장 선택 → 분석 시작 → (진행률) → /app/benchmark?audit=… 로 자동 이동 → 비교 카드 표시`.
네트워크 호출은 `POST /audits/{id}/screens`, `POST /audits/{id}/analyze`, `GET /analysis-jobs/{job}`, `GET /audits/{id}/regression`이었고 MSW 로그는 없었다.
이 자동 확인은 LLM 비용을 쓰지 않으려고 fake provider 서버로 했다(결과는 0건 비교). 실제 LLM 결과 화면은 아래 시연 진단으로 확인했다.

## 3. 시연용 데이터

### 수정본 화면 (`frontend/public/sample-audit-revised/`, 6장)
생성: `python demo/render_revised_pet.py` — 원본 데모 페이지(`frontend/public/dark-pattern-demo`)를 그대로 쓰고 렌더링 중에 `scenarios.js` 응답에 패치를 덧붙인다(데모 원본 파일은 수정하지 않음). 원본(`sample-audit/`)과 같은 393×852, 2배 크기.

| 화면 | 변경 |
| --- | --- |
| 1 보장 소개 | 월 이용료 총액 12,900 → **14,000원**, 세 번째 혜택 "모바일 간편 청구"를 "**필수 계약 관리비 1,100원 포함**"으로 교체(한 줄을 더하면 852px를 넘어서 교체) — DA-15 해결 |
| 2 특약 선택 | 특약 2개와 광고 수신 동의가 모두 **미선택** — DA-04 해결 |
| 3 개인정보 동의 | 혜택 목록의 체크 모양(✓)을 점(•)으로 교체. 원본·수정본 모두 이 ✓ 를 모델이 "선택된 동의"로 읽어 DA-04로 판정했기 때문 |
| 5 면책 조건 | "선택한 특약 2개 포함" → "선택한 특약 없음 (기본형)" (특약이 없는 수정본과 모순되지 않게) |
| 6 최종 보험료 | 데모 페이지가 선택 상태로 계산: 기본 12,900 + 필수 관리비 1,100 = **14,000원** |
| 4 | 원본과 같음(DA-12 죄책감 문구, DA-03 버튼 위계 유지) |

### 사전 실행 진단
| 항목 | 값 |
| --- | --- |
| **audit ID** | **`audit-3`** — "재검증 데모 · 모루 반려동물 보험 (원본 → 수정본)" (1회차 원본, 2회차 수정본) |
| **비교 화면 URL** | **`http://localhost:5173/app/benchmark?audit=audit-3`** |
| 진단 상세 URL | `http://localhost:5173/app/overview?audit=audit-3` (2회차 결과) |
| 사전 실행 진단 (재검증 없음) | `audit-1` — 별도, 변경 없음 |
| 저장 위치 | `data/darkaudit.db`, `data/uploads/audit-3/`(gitignore) — 시연 PC로 옮기려면 두 경로를 복사 |
| 분석 조건 | gpt-5.6-luna, OCR 켬, 프롬프트 변경 후 |

실행 방법: 저장소 루트에서 `python -m uvicorn backend.api.main:app --port 8000`, `frontend/`에서 `VITE_USE_MOCKS=false npm run dev`(프론트 기본 API는 `http://localhost:8000`, 다르면 `VITE_API_BASE_URL`).
- 이 PC에서는 포트 8000을 다른 프로그램이 쓰고 있다. 포트를 비우거나 `--port 8765` + `VITE_API_BASE_URL=http://localhost:8765`로 맞춘다.
- 루트 `.env`의 `DARKAUDIT_MODEL`이 `gpt-6-luna`다. 이미 저장된 진단을 보는 데는 영향이 없지만, 라이브 재분석 모델은 확인할 것.
- 배포본(Render)에는 이 audit이 없다(로컬 DB).

### 비교 결과 (audit-3)
해결률 **71% (7건 중 5건 해결)**: 해결 5 · 유지 1 · 개선 1 · 신규 0 · 재발 0.
- 해결: **DA-04** ×3(2단계 특약 사전선택, 모델이 같은 문제를 3건으로 냄), **DA-15**, DA-07 ×1
- 개선: DA-12 (높음 → 검토 필요), 유지: DA-07
- DA-04·DA-15가 해결로 나오는 것은 의도대로다. **DA-07 해결 1건은 수정하지 않은 화면에 대한 모델 판정 변동**이다(DA-07은 두 곳에 있었고 2회차에는 한 곳만 지목). 발표·시연에서 "수정한 것만 해결"이라고 단정하면 안 된다.

스크린샷(발표 슬라이드용, 2560×1800):
- `docs/screenshots/regression-compare.png` — 비교 카드
- `docs/screenshots/regression-compare-resolved-list.png` — "해결" 항목을 펼친 모습
- `docs/screenshots/overview-reupload-button.png` — 진단 상세의 "수정본 다시 올리기" 버튼

## 4. 실제 LLM 검증 기록 (gpt-5.6-luna, 복사본 DB, 상한 $0.3 → 실제 약 $0.297)

| 실행 | 결과 |
| --- | --- |
| 복사본 DB 1회(원본→수정본, 수정본 3단계 수정 전) | 해결: **DA-04, DA-15**, DA-03(수정하지 않은 화면, 모델 변동) / 신규: DA-04(3단계 ✓ 오인) / 유지: DA-07·DA-12 / 해결률 0.5 |
| 저장소 DB, 3단계 수정 전 시도 3회 | DA-04·DA-15 해결은 매번 재현. 3단계 DA-04가 유지로 남음 → 수정본 3단계를 고침 |
| 저장소 DB, 3단계 수정 후 → **audit-3** | 위 "비교 결과" |

- 같은 입력이어도 실행마다 모델 판정이 달라 해결/유지 목록이 조금씩 다르다(`docs/eval-results.md` §6.3, §14). 그래서 시연은 사전 실행 진단(`audit-3`)을 열고, 라이브 재분석은 보조로 쓰는 것을 권한다.
- 시도한 진단 중 audit-3을 남기고 나머지(중간 시도·미완료 1건)는 삭제했다. `audit-1`의 DB·업로드는 변경 없음을 확인했다.
- 호출 한도 때문에 마지막 시도 하나는 중단됐고 그 audit도 삭제했다.

## 5. 남은 한계
- 비교 목록은 규칙·위험도만 보여 준다. 항목을 눌러 해당 finding(화면·위치)으로 이동하는 연결은 하지 않았다(해결된 finding은 최신 회차에 없음).
- 사용자가 수동으로 "해결됨"으로 바꾼 상태가 재발 판정에 섞일 수 있다(`backend/app/regression.py`, `feature-spec` F-22). 이번 테스트는 모델 결과 기준의 재발만 검증한다.
- 회차를 선택해 비교하는 UI는 없고 최신 두 회차만 비교한다(API는 `from`/`to` 지원).

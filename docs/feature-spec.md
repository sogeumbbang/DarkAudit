# DarkAudit 기능명세서 (기획서 대비 구현 현황 포함)

- 작성일: 2026-10-02 / 대상 커밋: `614bc1a` (2026-09-29, 총 158커밋)
- 작성 방식: 코드 읽기·검색·테스트 실행만 수행했고 기존 코드는 수정하지 않았다.
- 근거 표기: `파일경로:라인`은 저장소 루트(`DarkAudit/`) 기준이다. **추측은 [추정]** 으로 표시했다.
  라인 번호는 코드 조사 결과를 옮긴 것이고, 그중 `regression.py`·`main.py`·`checks.py` 등 핵심 위치는 직접 재확인했다.
  나머지는 ±수 라인 오차가 있을 수 있으니 인용 전에 한 번 열어 보길 권한다.
- 기획서 기준선: `docs/2026_금융_AI_Challenge_공모전_기획서(개선본).md` (이하 "기획서")

---

## 0. 사전 파악

### 0.1 스택·구조·실행

| 영역 | 내용 | 근거 |
| --- | --- | --- |
| 백엔드 | Python 3.10+ / FastAPI + SQLAlchemy(SQLite) | `requirements.txt`, `backend/api/main.py` |
| AI 파이프라인 | `ai/` (OpenAI provider, Playwright 캡처, Tesseract OCR, 규칙 후보, 증거 계약) | `ai/README.md`, `AGENTS.md` |
| 규칙 | `rules/dark_pattern_rules.yaml` (15유형) → `rules/build_rules.py`가 JSON 생성 | `rules/build_rules.py:170-190` |
| 프론트 | React + TypeScript + Vite, Vitest, Playwright E2E | `frontend/package.json` |
| 데이터 | 합성 UI 생성기 + 정답 라벨 `data/generator`, `data/synthetic/labels` | `data/generator/README.md` |
| 배포 | Render(Docker, 백엔드) + Vercel(프론트) | `render.yaml`, `Dockerfile`, `frontend/vercel.json`, `docs/deploy.md` |
| CI | GitHub Actions 1개(`validation.yml`) | `.github/workflows/validation.yml` |

실행 방법 (`AGENTS.md`): 
```bash
python -m pip install -r requirements.txt
python -m uvicorn backend.api.main:app --reload --port 8000     # API
python -m unittest discover -s ai/tests -v                      # AI 테스트
python -m unittest discover -s backend/tests -v                 # 백엔드 테스트
python rules/build_rules.py --summary                           # 규칙 검증/빌드
cd frontend && npm install && npm run dev                       # 프론트 (5173)
```
(Windows 한국어 로케일에서는 `PYTHONUTF8=1`이 필요하다. `build_rules.py`가 `—` 출력 시 cp949 오류가 난다.)

### 0.2 환경변수 (`.env.example`, `render.yaml`, `frontend/.env.example`)

| 변수 | 용도 |
| --- | --- |
| `DARKAUDIT_PROVIDER` | `fake`(기본, 키 불필요) / `openai` |
| `OPENAI_API_KEY`, `DARKAUDIT_MODEL` | OpenAI 분석. 모델 기본값 없음(`ai/providers/factory.py:11`) |
| `DARKAUDIT_COMPUTER_MODEL` | URL 스마트 탐색(Computer Use) |
| `DARKAUDIT_OCR_PROVIDER`, `DARKAUDIT_TESSERACT_LANG` | OCR(기본 tesseract, kor+eng) |
| `DARKAUDIT_CHATBOT_ENABLED`, `DARKAUDIT_CHAT_MODEL`, `DARKAUDIT_EMBEDDING_MODEL` | RAG 챗봇 |
| `DARKAUDIT_FRONTEND_CONTRACT` | 프론트 노출 게이트(v1/v2, 기본 v2) |
| `FIGMA_ACCESS_TOKEN`, `FIGMA_*`, `DARKAUDIT_DEMO_FIGMA_URL` | Figma 임포트 |
| `BROWSERSTACK_USERNAME/ACCESS_KEY`, `ANDROID_MAX_SCREENS/ACTIONS` | APK 캡처 |
| `DARKAUDIT_CORS_ORIGINS` | CORS (Render) |
| `VITE_API_BASE_URL`, `VITE_USE_MOCKS`, `VITE_CHATBOT_ENABLED` | 프론트 |

### 0.3 최근 50커밋 변경 흐름 (2026-09-06 ~ 09-29)

1. 09-06 하루에 분석 파이프라인 수리·증거 계약 강화(`57ec857`), 화면 OCR/CV 위치 보정, Figma·APK·URL 입력 경로가 몰려 완성됐다.
2. 같은 날 Rule Engine 단독(`7c59e76`)과 하이브리드(`62d67b0`) 평가를 처음 실측하고 모델을 비교해 기준을 `gpt-5.6-luna`로 옮겼다(`6028a44`).
3. DA-07 후보 폭주 수정(`6d25907`), Rule Engine 평가 대상을 MVP 5종으로 정렬(`1595a75`) 등 오탐 정리가 이어졌다.
4. 09-06~07 심사위원용 데모(웹·Figma·APK·스크린샷 4종 6화면 흐름)와 배포 문서가 추가됐다.
5. 09-27 이후 RAG 챗봇, 09-28~29 대시보드·리포트·지도형 검토 UI 개편이 이어졌고 **AI/규칙/평가 코드는 09-06 18:27 이후 변경이 없다.**

### 0.4 기존 평가 결과 위치 (상세는 `docs/eval-results.md`)

| 파일 | 측정 시각(KST) | 기록 커밋 |
| --- | --- | --- |
| `docs/eval/rule_engine_report.json` | 2026-09-06 20:20 | 파일 내 커밋 해시 없음. git 기준 `1595a75`(09-06 20:21) |
| `docs/eval/hybrid_report.json` (= `.gpt-5.6-luna.json`, 바이트 동일) | 2026-09-06 17:42 | 해시 없음. 커밋 `88a3057`(18:12) |
| `docs/eval/hybrid_report.gpt-5.4-mini.json` | 2026-09-06 15:48 | 해시 없음. 커밋 `6028a44` — 근거 검증 도입 전 |

---

## 1. 개요

- **목적**: 금융상품 가입·이용 화면에서 금융위 15개 다크패턴 유형에 해당할 수 있는 요소를 사전에 찾아내 "검토 후보"로 제시하고, 수정 후 재진단으로 해결 여부를 확인한다. 법적 위반 확정이 아니다(`ai/specs/rule_ai_contract.md`).
- **사용자**: 금융 서비스 기획·디자인·QA·소비자보호 담당자(기획서 §2).
- **자동 분석 범위**: 15유형 중 5종 — DA-03, DA-04, DA-07, DA-12, DA-15 (`ai/README.md`, `ai/schemas/audit_schema.py:57-63`).

### 처리 흐름

```
[입력]  스크린샷 업로드 | 개발 URL(Playwright) | Figma URL(REST) | APK(BrowserStack)
   │          POST /audits/{id}/screens | /capture | /figma | /mobile-app
   ▼
[수집·구조화]  화면 이미지 + (URL/APK) DOM·접근성 요소(bbox,state,style)
   │          OCR(Tesseract) → 텍스트 앵커
   ▼
[규칙 후보]   rules/dark_pattern_rules.yaml → Rule Engine(checks.py 11개 체크) → 후보·점수
   │          (DOM/APK 있을 때만. 스크린샷·Figma는 후보 없이 LLM 단독)
   ▼
[LLM 의미 검증]  멀티모달 LLM: 후보 KEEP/REJECT + semantic finding + 규칙별 assessment
   │
   ▼
[증거 계약]   허용 규칙·스키마·0~1 bbox·신뢰도 0.70·재시도/항목별 복구 (assessment_contract / evidence_recovery)
   │
   ▼
[위치 보정]   OCR 앵커 → CV 후보(C1..Cn) → 번호 선택(Set-of-Mark) → 정규화 bbox (실패 시 모델 bbox 유지)
   │
   ▼
[저장·노출]   SQLite(AuditRun/Finding) → API → 프론트(대시보드·검토 화면·인쇄 PDF)
   │
   ▼
[재검증]     재업로드 → 새 AuditRun(version+1) → fingerprint 비교 → 해결/유지/개선/신규/재발 (API만, UI 미연결)
```

---

## 2. 기능 요약 표

범례: 구현 상태 = 완료 / 부분 구현 / 미구현 / 목업만 존재. 기획서 반영 = 기획서에 계획된 항목이면 ● , 코드에서 새로 생긴 항목이면 ○.

| ID | 기능명 | 분류 | 기획서 반영 | 구현 상태 | 담당 모듈 |
| --- | --- | --- | --- | --- | --- |
| F-01 | 스크린샷 1~6장 순서 업로드 | 입력 | ● | **완료** | `backend/api/main.py`, `AuditSourceFields.tsx` |
| F-02 | Figma 입력(직접 연동) | 입력 | ● | **완료** | `backend/api/figma_*.py` |
| F-03 | 개발 URL + DOM 수집 | 입력 | ● | **완료** | `ai/browser/`, `ai/pipeline/web_audit.py` |
| F-04 | Android APK 입력 | 입력 | ● | **완료**(BrowserStack 필수) | `backend/api/android_*.py` |
| F-05 | 화면 순서 지정·변경 | 입력 | ● | 부분 구현 | `main.py`, `AuditSourceFields.tsx` |
| F-06 | OCR/UI 파싱(Text/Button/Checkbox/Toggle/Price/CTA) | UI 분석 | ● | 부분 구현 | `ai/vision/ocr.py`, `playwright_driver.py` |
| F-07 | 요소별 bbox·선택상태·상대크기·위계 | UI 분석 | ● | 부분 구현 | `playwright_driver.py`, `checks.py` |
| F-08 | Structured UI Representation | UI 분석 | ● | 부분 구현 | `rule_engine/core.py`, `ai/schemas/` |
| F-09 | 15유형 Machine-readable Rule | 기준·탐지 | ● | **완료** | `rules/dark_pattern_rules.yaml` |
| F-10 | Deterministic Rule 후보 탐지 | 기준·탐지 | ● | 부분 구현 | `backend/app/rule_engine/` |
| F-11 | 멀티모달 LLM 의미 검증(5역할) | 기준·탐지 | ● | **완료**(⑤는 얕음) | `ai/pipeline/baseline.py`, `ai/prompts/` |
| F-12 | 금융위 유형 매핑 | 기준·탐지 | ● | 부분 구현 | `ai/schemas/audit_schema.py` |
| F-13 | 증거 계약 검증 | 기준·탐지 | ● | **완료** | `assessment_contract.py`, `evidence_recovery.py` |
| F-14 | MVP 우선 유형 지원 | 기준·탐지 | ● | 부분 구현 | 아래 §4 |
| F-15 | 15유형 중 미지원 목록 | 기준·탐지 | ● | 부분 구현(10/15 미지원) | 아래 §4 |
| F-16 | Evidence Report 6요소 | 결과 | ● | 부분 구현 | `audit_schema.py`, `store.py`, `AuditReport.tsx` |
| F-17 | 결과 등급 | 결과 | ● | 부분 구현(문구 상이) | `schemas.py`, `compat.py` |
| F-18 | 규칙별 상태 4종 | 결과 | ● | **완료** | `assessment_contract.py`, `quality.py` |
| F-19 | 화면 위 위험 위치 표시 | 결과 | ● | 부분 구현('위치 미검증' 없음) | `ai/vision/`, `ScreenCanvas.tsx` |
| F-20 | 개선안 생성 | 결과 | ● | 부분 구현 | `Detection.fix`, `suggestion.py` |
| F-21 | 수정본 Before/After | 재검증 | ● | 부분 구현(**백엔드 완료, 프론트 미연결**) | `regression.py`, `main.py:134` |
| F-22 | fingerprint 판정(재발 포함) | 재검증 | ● | **완료**(재발 테스트 없음) | `fingerprint.py`, `regression.py` |
| F-23 | Resolved Finding Ratio | 재검증 | ● | 부분 구현(**백엔드 완료, 프론트 미연결**) | `regression.py:55-62` |
| F-24 | Synthetic Financial UI Dataset | 데이터·평가 | ● | 부분 구현(보험·예적금만) | `data/generator/` |
| F-25 | Counterfactual Pair | 데이터·평가 | ● | **완료** | `data/generator/configs`, `evaluator.py` |
| F-26 | Precision/Recall/Macro F1/FPR | 데이터·평가 | ● | 부분 구현(FPR 없음) | `ai/evaluation/metrics.py` |
| F-27 | 위치 지표(IoU 0.5) | 데이터·평가 | ● | **완료**(명칭 상이) | `evaluator.py` |
| F-28 | 업무 지표(검수시간·일치도·일관성) | 데이터·평가 | ● | **미구현** | — |
| F-29 | 웹 대시보드가 실 API에 연결 | 서비스 | ● | **완료**(dev는 MSW) | `frontend/src/api/` |
| F-30 | 결과 내보내기 | 서비스 | ● | 부분 구현(브라우저 인쇄 PDF만) | `AuditReport.tsx` |
| F-31 | 보안(외부 전송 정책·마스킹) | 서비스 | ● | **미구현** | — |
| F-32 | 배포(Render/Vercel) | 서비스 | ● | **완료**(설정 기준) | `render.yaml`, `vercel.json` |
| F-33 | 장기 확장(Figma·E2E·CI/CD) | 서비스 | ● | 부분 구현 | 아래 F-33 |

**집계: 33개 중 완료 13 / 부분 구현 18 / 미구현 2 / 목업만 존재 0.**
(완료 = F-01,02,03,04,09,11,13,18,22,25,27,29,32. 미구현 = F-28, F-31.)

### 추가 구현 (기획서에 없거나 초안 이후 생긴 기능)

| 기능 | 근거 |
| --- | --- |
| 다크패턴 가이드라인 RAG 챗봇 | `ai/rag/`, `backend/api/chat.py:84`, `frontend/src/features/chatbot/`, 커밋 `f45f6f8`, `4ab9dcd` |
| Computer Use 스마트 URL 탐색 | `ai/providers/computer_use.py`, `ai/browser/explorer.py` |
| 심사위원용 데모(웹·Figma·APK·스크린샷 4종) | `demo/`, `backend/api/demo_inputs.py`, 커밋 `8c162fb`, `cf78e06`, `2278452` |
| Finding 결정 메모 | `PUT /api/v1/findings/{id}/decision` (`main.py:387`), `FindingDecisionNote.tsx` |
| 진단 삭제(파일 포함) | `DELETE /api/v1/audits/{id}` (`main.py:109`) |
| 프론트 계약 게이트 v1/v2 | `backend/api/compat.py`, `DARKAUDIT_FRONTEND_CONTRACT` |
| 모델별 비교 도구 | `backend/compare_eval.py` |
| 지도형 검토 UI, 주석 PDF 리포트 | 커밋 `710a08e`, `e5aa7e4` |

---

## 3. 기능 상세

### F-01 스크린샷 업로드 — 완료
- **설명**: 1~6장을 가입 순서대로 업로드한다.
- **입출력**: `POST /api/v1/audits/{id}/screens` (multipart `files`, `flow_steps`, 헤더 `X-DarkAudit-Screen-Metadata`) → `AuditDto`.
- **처리**: 장수 1~6(`main.py:182`), 장당 10MB, PNG/JPG/WEBP만, EXIF 보정 후 PNG 정규화, 업로드 순서 = `screen_index`(`main.py:199-221`). 이미 분석된 audit에 올리면 `next_run`으로 새 회차 생성(`service.py:116-126`).
- **관련 파일**: `backend/api/main.py`, `frontend/src/pages/audit-create/AuditCreatePage.tsx:200-203`, `AuditSourceFields.tsx:361-421`.
- **근거**: 위 라인. **제약**: 기획서는 "1~5장 이상"이고 코드 상한은 6장(서버·프론트 하드코딩). 전체 파일을 메모리로 읽는다.

### F-02 Figma 입력 — 완료(직접 연동)
- **설명**: 캡처 업로드가 아니라 Figma REST API로 프레임을 직접 가져온다.
- **입출력**: `POST /api/v1/audits/{id}/figma` (`fileUrl`, `target`, `selectionMode`(prototype-flow/all-frames), `flowName`; `schemas.py:161-165`) → `JobDto`(202).
- **처리**: 서버 전역 Personal Access Token(`figma_client.py:92-94`), 프레임 상한 `FIGMA_MAX_FRAMES`=6, 모바일 세로형 프레임만, 프로토타입 연결 경로 추적(`figma_frames.py:158-227`), 상한 초과 시 `figma_omitted_frames` 경고.
- **제약**: 사용자별 OAuth 아님. 이미지만 받으므로 DOM·스타일 없음(LLM 단독 경로). **실 토큰 연동 검증은 fixture·모의 수집기 수준**이라고 기획서도 적는다(기획서 4-1, 7-1).

### F-03 개발 URL + DOM 수집 — 완료
- **입출력**: `POST /api/v1/audits/{id}/capture` (`mode` quick/smart, `profiles` desktop/mobile, `goal`; `schemas.py:168-174`) → `JobDto`.
- **처리**: Playwright가 요소별 bbox(viewport 비율), `state.checked/expanded/disabled`, `computed_style`(font_size, contrast_ratio, area_ratio, animated) 수집(`playwright_driver.py:100-139,495-518`). 풀페이지 분할·DOM crop(`web_audit.py:174,222`). `UrlSafetyPolicy`로 사설망 차단(`ai/browser/safety.py`).
- **제약**: smart 모드는 `DARKAUDIT_COMPUTER_MODEL` 필요. 배치당 최대 5장(`web_audit.py:90-93`).

### F-04 Android APK — 완료(BrowserStack 필수)
- **입출력**: `POST /api/v1/audits/{id}/mobile-app` (multipart APK) → `JobDto`.
- **처리**: `.apk`·100MB·`PK` 시그니처·`AndroidManifest.xml` 검증(`main.py:308-335`), BrowserStack App Automate에서 탭·스크롤·뒤로가기로 탐색, 최대 6화면/20액션(`android_runner.py:38-59`), 접근성 XML을 요소로 정규화(`:323-345`).
- **제약**: 키 없으면 503. iOS 미지원. 외부 유료 서비스 의존. 실기기 E2E는 본 조사에서 실행하지 않았다.

### F-05 화면 순서 지정·변경 — 부분 구현
- 지정: 업로드 순서와 `flow_steps` 라벨 편집은 됨(`AuditSourceFields.tsx:396-402`).
- **변경**: 재정렬 UI·API가 없다. 순서를 바꾸려면 삭제 후 재추가. Figma는 프로토타입 경로/이름 접두/좌표 순 자동 정렬(`figma_frames.py:111-115`).

### F-06 OCR / UI 파싱 — 부분 구현
- OCR은 Tesseract kor+eng(`ai/vision/ocr.py:50-146`).
- `ai/vision/ui_parser.py`(22줄)는 OCR 블록을 전부 `text`로 바꾸는 pass-through다. **스크린샷·Figma 입력에서는 Button/Checkbox/Toggle/Price/CTA 분류를 하지 않는다.**
- 유형 분류는 URL(DOM JS `typeOf`: checkbox/radio/switch/accordion/button/link/price/text)과 APK(checkbox/button/text)에서만 된다. toggle은 checkbox로 합쳐지고 `cta` 타입은 없다.
- 이미지 보조: 체크박스·CTA 후보 CV(`bbox_refinement.py:25,140`, `candidate_grounding.py:25,236`).

### F-07 요소별 bbox·선택상태·상대크기·위계 — 부분 구현
- bbox: DOM/APK/OCR 모두 있음. 선택 상태: DOM `state.checked`, APK `checked`(`android_runner.py:341`). 상대 크기: `area_ratio`, DA-03 면적비 1.5·폰트비 1.3(`checks.py:61-90`). 위계 전용 모델은 없고 룰 비율로 간접 계산.
- **스크린샷 경로에는 요소별 크기·선택상태 필드가 없다.**

### F-08 Structured UI Representation — 부분 구현
- 웹/APK/합성 데이터는 `Element`(`rule_engine/core.py:36-60`: element_id, element_type, text, bbox, state, style)로 통일. 입력 계약 `ai/schemas/audit_input.py`, 출력 계약 `audit_schema.py:84-260`.
- 이미지 입력용 구조화 스키마·파서는 사실상 없다(F-06 참조).

### F-09 15유형 Machine-readable Rule — 완료
- `rules/dark_pattern_rules.yaml`: **15/15 작성**(`meta.rule_count: 15`, 라인 38). **모든 규칙에** `observable_features`, `semantic_checks`, `required_evidence`(+ `deterministic_checks`, `mitigating_checks`, `combination_amplifiers`, `mvp_priority`, `standalone_sufficient`)가 있다.
- `build_rules.py`가 검증·JSON 생성. `--summary` 실행 결과: P0 6개(DA-03/04/07/12/13/15), P1 6개, P2 3개. 단독 HIGH 금지: DA-09/12/13/14.
- `fix_template`은 DA-04·DA-12·DA-15 3개에만 있다(`:228,506,614`).
- **제약**: 규칙 정의가 있다고 탐지되는 것은 아니다(→ §4).

### F-10 Deterministic Rule 후보 탐지 — 부분 구현
- 구현 체크 **55개 선언 중 11개**(`eval_rule_engine.py` 출력, `core.py:161-174` `audit_coverage`).

| DA | 구현 체크 | 방식 |
| --- | --- | --- |
| 03 | area_ratio≥1.5, font_size_ratio≥1.3, color_prominence_gap (`checks.py:61-107`) | UI 크기 비율 |
| 04 | default_checked (`:113-129`) | 체크박스 선택 여부(radio/toggle 미처리) |
| 07 | benefit_risk_asymmetry, detail_behind_click (`:150-196`) | 작은 폰트+저대비, 접힌 accordion |
| 12 | emotive_lexicon_hit (`:202-219`) | 어휘 목록 |
| 13 | motion_emphasis (`:225-236`) | **파이프라인에서 제외됨**(`rule_candidates.py:10,46` `only=MVP_RULE_IDS`) |
| 15 | price_increase / rate_deterioration / single_point_rate (`:253-328`) | 첫·마지막 화면 금액·이율 정규식 비교 |

- **없는 것**: 화면 수·클릭 수·반복 횟수 계산(DA-01/06/09/11), DA-02/05/08/10/14 체크.
- 후보 흐름: `ai/pipeline/rule_candidates.py:13-55` → `severity.py:98-136`(단독 불충분 시 REVIEW, 결합 증폭 시 HIGH).
- 구형 경로 `ai/pipeline/analyzer.py`·`detector.py`는 테스트에서만 쓰인다 [추정: 운영 경로 아님].

### F-11 멀티모달 LLM 의미 검증 — 완료(⑤ 얕음)

| 역할 | 상태 | 근거 |
| --- | --- | --- |
| ① UI 의미 이해 | 구현 | `ai/prompts/audit_v1.md:23`, `dom.md:3-4`, `visual.md:5` |
| ② 감정적 문구 판단 | 구현 | `audit_v1.md:25`, `assessment_contract.py:22` |
| ③ 시각적 위계 해석 | 구현 | `audit_v1.md:21`(choice_pairs), `baseline.py:167` |
| ④ Cross-screen 가격 추적 | 구현 | `audit_v1.md:26,30-32`, `assessment_contract.py:148-243` |
| ⑤ 수정안 생성 | 구현(얕음) | `Detection.fix` 필수(`audit_schema.py:273,283`). 대안 UI 생성 없음 |

- 호출: `openai_provider.py:113` (화면 `detail: high`). DOM이 있으면 새 semantic finding을 DA-03/DA-12로 한정(`web_audit.py:127-130`), 이미지 모드는 5개 규칙 전부 LLM 단독 가능(`visual.md:5`).
- 한계: 먼 단계 간 가격 전부 비교는 보장하지 않는다(`quality.py:19-20`).

### F-12 금융위 유형 매핑 — 부분 구현
- 매핑 고정: `RiskType`→DA-id/이름/기본 severity(`audit_schema.py:32-55`), 모델이 다르게 쓰면 `normalize_derived_labels`가 덮어씀(`response_parser.py:58-98`).
- **5개 규칙만 매핑**(`RULE_BASE_SEVERITY`, `audit_schema.py:57-63`). 나머지 10개는 YAML 정의만 있다.

### F-13 증거 계약 검증 — 완료(지원 5규칙 범위)
- 허용 규칙(`response_parser.py:28-55`), 규칙별 assessment 정확히 5개(`assessment_contract.py:47-54`), 체크 이름 집합 일치(`:96-100`), bbox `[x,y,w,h]` 0~1(`audit_schema.py:84-95`), 신뢰도 <0.70 제외(`baseline.py` `_filter_and_deduplicate`), finding severity는 Rule Base 값(`audit_schema.py:281`), DA-03 choice_pairs·DA-15 시계열 검증.
- 실패 시 재요청 후 항목별 복구(`evidence_recovery.py:22-111`), 제외 내역 `rejected_evidence`. fake provider 결과는 `mock_analysis`로 `not_supported` 처리(`quality.py:44-45`).

### F-14 / F-15 MVP 우선 유형·미지원 유형 — 부분 구현
→ **§4 표** 참조. 자동 탐지: **DA-03, 04, 07, 12, 15 (5개)**. 기획서 MVP 7종 중 DA-13(감각조작), DA-14(타 소비자 활동 알림), DA-09(클릭 피로)는 **미탐지**.

### F-16 Evidence Report 6요소 — 부분 구현
| 요소 | AI 스키마 | DB | API/프론트 |
| --- | --- | --- | --- |
| WHERE | `where{screen_ids,element,location}`, `bbox` | `where_text` | `screenIds/element/bbox` (location 문장은 응답에 없음) |
| WHAT | `what` | `what_text` | `element`로 대체(`store.py:219`) |
| OBSERVATION | `observation` | `observation` | optional(`schemas.py:99`) |
| RULE | `rule_id`,`risk_type` | 〃 | `ruleId`,`riskType`,`guideline` |
| WHY | `why` | `why_text` | `description` |
| FIX | `fix` | `fix_text` | `recommendation` |
- 스키마·DB는 6요소 완비(`audit_schema.py:248-293`, `models.py:284-289`). **UI에 WHERE/WHAT/… 라벨 구조는 없고** 보고서가 항목을 풀어서 표시(`AuditReport.tsx:30-78`).

### F-17 결과 등급 — 부분 구현
- 코드 체계는 `Severity = HIGH | REVIEW | LOW`(`schemas.py:33`, `audit_schema.py:22-24`는 HIGH/REVIEW만). "High-risk candidate / Review required / No risk detected" **문구는 코드에 없다.**
- "No risk"에 대응하는 것은 규칙별 `not_detected` 상태(F-18). 처리 상태(`open/reviewing/resolved`)는 severity와 별개(`AuditReport.tsx:11`).

### F-18 규칙별 상태 — 완료
- `STATUSES = {detected, not_detected, insufficient_evidence, not_supported}`(`assessment_contract.py:25`), UI 라벨 탐지됨/미탐지/근거 부족/미지원(`AuditReport.tsx:12-17`), 집계 `quality.py:61-73`, 신뢰도 미달 강등 `baseline.py:317`.
- 제약: 상태는 5개 지원 규칙에 대해서만 산출되고 `analysisSummary` JSON에 담긴다(`schemas.py:149`). 나머지 10유형이 "미지원"으로 화면에 나오는지는 확인하지 못했다.

### F-19 화면 위 위험 위치 표시 — 부분 구현
- OCR 앵커(`candidate_grounding.py:56-101`) → CV 후보 `C1..Cn`(`:228,373`) → 번호 배지 크롭 + 선택기(`:383-519`, `openai_provider.py:142`) → 정규화 bbox → 프론트 오버레이(`ScreenCanvas.tsx:44-52`). DA-04 컨트롤 보정 `bbox_refinement.py:19-80`.
- 실패 시 `GroundingResult.source`(verification-failed 등)와 텔레메트리 경고만 남는다. **"위치 미검증" 문구·필드·UI 표시는 없다.** 선택기가 없으면 CV 상위 후보를 자동 사용.

### F-20 개선안 생성 — 부분 구현
- 실제 경로: LLM `Detection.fix`(필수) → `fix_text` → `recommendation`(`service.py:540`, `store.py:225`). 규칙 `fix_template`은 3개 규칙뿐.
- `ai/pipeline/suggestion.py`는 템플릿/고정문구 수준이며 API에서 호출되는지 확인하지 못했다 [추정: 레거시]. **대안 UI 생성은 없다.**

### F-21 수정본 Before/After — 부분 구현(백엔드 완료, 프론트 미연결)
- 재업로드 → `next_run`(version+1) → 분석 완료 후 `_apply_regression`이 직전 DONE 회차와 비교(`service.py:116-126,570-581`). 조회 `GET /api/v1/audits/{id}/regression?from=&to=`(`main.py:134`), 테스트 `test_api.py:467-525`.
- **`frontend/src`에는 regression 호출·재진단 UI가 없다.** `compare()`는 호출 때마다 `Finding.status`를 갱신하는 부작용이 있다.

### F-22 fingerprint 해결/유지/신규/재발 — 완료
- fingerprint = `rule_id`+`label_unit`+`screen_index`+0.1 격자 bbox+정규화 텍스트(숫자 마스킹, 24자) sha1 12자(`fingerprint.py:68-102`).
- 분류(`regression.py:113-135`): 이전에만=resolved, 양쪽=persisted(심각도 하락 시 improved), 현재에만=new.
- **재발 조건 존재**: 현재에만 있으면서 이전 회차들 중 한 번이라도 `RESOLVED`였던 fingerprint면 `regressed`, `FindingStatus.REGRESSED`로 표시(`regression.py:113,128-132`, `_previously_resolved` `:82-93`).
- 테스트: 재발(REGRESSED)·신규 판정은 `backend/tests/test_regression_regressed.py`(API 수준 3개)로 검증한다(브랜치 `feat/regression-backend`). `test_api.py`는 해결·409·404 경로를 검증한다.
- 제약: `PATCH /findings/{id}`로 사용자가 수동 resolved 처리한 것도 "해결된 적 있음"으로 쓰여 재발 판정을 오염시킬 수 있다 [추정].

### F-23 Resolved Finding Ratio — 부분 구현(백엔드 완료, 프론트 미연결)
- 식: `resolved / (resolved + persisted + improved)`, 분모 0이면 0.0(`regression.py:55-62`). API `resolvedRatio`(`store.py:340`, `schemas.py:202`). `new`/`regressed`는 분모에 포함되지 않는다.
- **프론트에서 `resolvedRatio`를 쓰는 곳이 없다.**

### F-24 Synthetic Financial UI Dataset — 부분 구현
- 업권: **보험(ins-001~009)·예적금(dep-001~002)만**. 대출·투자 flow 없음(`data/generator/flows/insurance.py`, `deposit.py`). 11쌍=22 flow, flow당 5화면=110화면, 390×844.
- 라벨: `data/synthetic/labels/{flow_id}.json`. 스크린샷·HTML·UI JSON은 생성물이라 저장소에 없다(`.gitignore`).
- 제약: 라벨이 생성기가 심은 패턴 기준이라 독립 검수가 필요(`data/generator/README.md`).

### F-25 Counterfactual Pair — 완료
- 설정 한 줄 차이로 Risky/Clean 쌍 보장, `pair_id`/`variant`. 일관성 지표 `evaluator.py:113,174-`. 단일 패턴 flow(ins-002~008, dep-002)는 격리 측정용. `ins-009`는 `mitigate_DA-04`(severity 하향) 검증.

### F-26 평가 지표 — 부분 구현
- Precision/Recall/F1/Macro: `ai/evaluation/metrics.py:3-10`, `evaluator.py:88-90`. **FPR(FP/(FP+TN))은 코드에 없다**(`grep fpr|false.positive` 0건). 기획서 6-1은 "정상 화면 오탐률"을 목표 지표로 명시.

### F-27 위치 지표 — 완료
- `bbox_iou`(`metrics.py:16`), IoU 임계 기본 0.5(`evaluator.py:59`, `ai/cli.py:39`), `localization.{mean_iou,success_rate}`, 요소 단위 매칭 `instance_detection`(`evaluator.py:126-`).
- "Correct Element Localization Rate"라는 이름의 지표는 없고 `success_rate`가 사실상 대응 [추정].

### F-28 업무 지표 — 미구현
- 화면당 평균 검수시간, Human Review 일치도: 코드·데이터 없음(기획서도 후속 과제, `README.md` 한계). 판정 일관성은 `eval_hybrid.py --runs N`의 variation(`:212-220`)이 대용이나 전용 지표 아님.

### F-29 웹 대시보드 API 연결 — 완료
- 대시보드는 `GET /api/v1/dashboard/summary` 실 API 호출(`frontend/src/api/dashboard.ts`). 목업(MSW)은 **dev 모드에서만** 자동 활성(`frontend/src/main.tsx:10`: `!DEV || VITE_USE_MOCKS==="false"`면 끔). 프로덕션 빌드는 항상 실 API, `VITE_API_BASE_URL` 비면 `https://darkaudit.onrender.com` 폴백(`client.ts:1-10`). E2E(`.env.e2e`)는 `VITE_USE_MOCKS=true`.

### F-30 결과 내보내기 — 부분 구현
- `window.print()` 기반 PDF("PDF 보고서 출력", `AuditReport.tsx:106-132`, `OverviewPage.tsx:625`, 인쇄 CSS `audit-report.css`). PDF 라이브러리·서버 측 export·공유 링크 없음.

### F-31 보안 — 미구현
- 외부 모델 전송 고지/동의·민감정보 마스킹 코드 없음(스크린샷이 OpenAI로 그대로 전송). 있는 것: 업로드 검증, 삭제 API, URL 사설망 차단, 챗봇 끄기 변수.

### F-32 배포 — 완료(설정 기준)
- `render.yaml`(Docker 웹서비스, free), `Dockerfile`(playwright chromium + tesseract kor+eng), `frontend/vercel.json`(SPA rewrite), `docs/deploy.md`. 무료 티어 슬립·콜드스타트 주의. **라이브 URL 동작은 이번에 확인하지 않았다.**

### F-33 장기 확장 — 부분 구현
- Figma 직접 연동: 착수·구현(F-02). E2E 자동 진단: URL 자동 탐색 구현(F-03), "화면 변경 후 자동 재점검"은 미구현(기획서 6-2). CI/CD: **CI만 있음**(`validation.yml`: 단위테스트·rules 빌드·프론트 lint/test/build·Playwright). CD 워크플로·평가 CI 없음.

---

## 4. 지원 다크패턴 유형 표

| DA | 유형 | 우선 | 상태 | 판단 방식 | 근거 |
| --- | --- | --- | --- | --- | --- |
| 01 | 설명절차의 과도한 축약 | P2 | 미지원 | — | 체크 없음 `checks.py` |
| 02 | 속임수 질문 | P1 | 미지원 | — | 〃 |
| 03 | 잘못된 계층구조 | P0 | **자동 탐지** | 혼합(비율 코드 + LLM) | `checks.py:61-107`, `assessment_contract.py:105-147` |
| 04 | 특정옵션의 사전선택 | P0 | **자동 탐지** | 혼합(DOM) / LLM 단독(이미지) | `checks.py:113-129`, `visual.md:5` |
| 05 | 허위광고·기만적 유인 | P1 | 미지원 | — | `RULE_BASE_SEVERITY`에 없음 |
| 06 | 취소·탈퇴 방해 | P1 | 미지원 | — | 〃 |
| 07 | 숨겨진 정보 | P0 | **자동 탐지** | 혼합 | `checks.py:150-196` |
| 08 | 가격비교 방해 | P2 | 미지원 | — | — |
| 09 | 클릭 피로감 유발 | P1 | 미지원 | — | 클릭 수 계산 없음, `visual.md:6-7`은 클릭 이력 추측 금지 |
| 10 | 계약과정 중 기습적 광고 | P2 | 미지원 | — | — |
| 11 | 반복간섭 | P1 | 미지원 | — | 반복 횟수 계산 없음 |
| 12 | 감정적 언어사용 | P0 | **자동 탐지**(항상 REVIEW) | 혼합(어휘 + LLM) | `checks.py:202-219` |
| 13 | 감각조작 | P0 | **미지원(코드만 있고 비활성)** | 코드(비활성) | `checks.py:225-236`, 제외 `rule_candidates.py:10,46` |
| 14 | 다른 소비자의 활동 알림 | P1 | 미지원 | — | 코드·프롬프트 없음 |
| 15 | 순차공개 가격책정 | P0 | **자동 탐지** | 혼합 | `checks.py:253-328`, `assessment_contract.py:148-243` |

- **자동 탐지 5종: DA-03, 04, 07, 12, 15.** 미지원 10종: DA-01, 02, 05, 06, 08, 09, 10, 11, 13, 14.
- **"근거 부족만 가능"으로 분류되는 유형은 없다.** `insufficient_evidence` 상태는 지원 5규칙 안에서만 쓰인다.
- 기획서 MVP 7종 대비: 사전선택(04)✔, 잘못된 계층구조(03)✔, 감정적 언어(12)✔, 순차공개 가격(15)✔, 감각조작(13)✘, 타 소비자 활동 알림(14)✘, 클릭 피로(09)✘. (기획서 자체도 자동 분석 범위를 5종으로 명시.)

---

## 5. API 목록

| 메서드 | 경로 | 위치 | 용도 |
| --- | --- | --- | --- |
| GET | `/health` | `main.py:88` | 상태 확인 |
| POST | `/api/v1/audits` | `main.py:93` | 진단 생성(201) |
| GET | `/api/v1/dashboard/summary` | `main.py:102` | 대시보드 요약 |
| DELETE | `/api/v1/audits/{audit_id}` | `main.py:109` | 진단·파일 삭제(204) |
| GET | `/api/v1/audits/{audit_id}/regression?from=&to=` | `main.py:134` | 회차 비교 |
| POST | `/api/v1/audits/{audit_id}/screens` | `main.py:174` | 스크린샷 1~6장 업로드(새 회차) |
| POST | `/api/v1/audits/{audit_id}/analyze` | `main.py:229` | 업로드 화면 분석(202) |
| POST | `/api/v1/audits/{audit_id}/capture` | `main.py:247` | URL 캡처+분석(202) |
| POST | `/api/v1/audits/{audit_id}/figma` | `main.py:274` | Figma 임포트+분석(202) |
| POST | `/api/v1/audits/{audit_id}/mobile-app` | `main.py:295` | APK 임포트+분석(202) |
| GET | `/api/v1/analysis-jobs/{job_id}` | `main.py:364` | 작업 상태 |
| PATCH | `/api/v1/findings/{finding_id}` | `main.py:372` | 처리 상태 변경(resolved/그 외=OPEN) |
| PUT | `/api/v1/findings/{finding_id}/decision` | `main.py:387` | 결정 메모 저장 |
| POST | `/api/v1/chat` | `chat.py:84` | RAG 챗봇 |
| GET | `/demo/web/{filename}` | `demo_inputs.py:20` | 데모 웹 |
| GET | `/demo/darkaudit-demo.apk` | `demo_inputs.py:27` | 데모 APK |
| GET | `/api/v1/demo-inputs` | `demo_inputs.py:36` | 데모 입력 목록 |

---

## 6. 미구현·보완 필요 기능 (우선순위)

작업량: S ≤ 1일, M 2~4일, L 1주 이상 (개략 추정).

### 6.1 본선 시연 전 필수
| # | 항목 | 이유 | 량 | 관련 파일 |
| --- | --- | --- | --- | --- |
| 1 | DA-13 활성화·DA-14 신규(MVP 우선인데 미탐지) | 기획서 MVP 7종 중 3종 누락. DA-13은 체크가 이미 있어 제외 해제+평가 정렬 | DA-13 S, DA-14 M | `rule_candidates.py:10,46`, `audit_schema.py:57-63`, `assessment_contract.py`, `dark_pattern_rules.yaml` |
| 2 | ~~하이브리드 DA-03/DA-15 재현율 0 개선~~ → **평가 스크립트 결함으로 확인·수정(브랜치 `fix/da03-da15-contract`)**. 수정 후 DA-03 R 1.00 / DA-15 R 0.89, 상세는 `docs/eval-results.md` §8. 남은 과제: DA-03 clean 오탐(6%), 운영 `candidate_payload` 중복 처리 | S | `backend/eval_hybrid.py`, `ai/pipeline/rule_candidates.py` |
| 3 | 프론트 Before/After + Resolved Ratio 화면 | 재검증이 핵심 가치인데 API만 있음. 이번에는 백엔드만 두기로 함(프론트 구현은 보관 브랜치 `feat/regression-ui-frontend`) — `docs/regression-demo.md` | M | `frontend/src/api/audits.ts`, `AuditReport.tsx`, `main.py:134` |
| 4 | 외부 모델 전송 고지/동의 + 최소 마스킹 | 금융 화면 외부 전송 정책 부재(F-31) | M | `openai_provider.py`, `AuditCreatePage.tsx` |
| 5 | FPR 지표 추가 + 기획서 수치 갱신 | 기획서 7-2 수치가 현재 JSON과 불일치, FPR 목표 지표 미산출 | S | `ai/evaluation/evaluator.py`, 기획서 §7-2 |

### 6.2 있으면 좋음
| 항목 | 량 | 관련 파일 |
| --- | --- | --- |
| "위치 미검증" 상태 필드·UI 표시(F-19) | M | `candidate_grounding.py`, `schemas.py`, `ScreenCanvas.tsx` |
| 재발(REGRESSED) 단위테스트 + 수동 resolved 오염 방지 | S | `regression.py:82-135`, `backend/tests/` |
| 화면 순서 재정렬 UI/API(F-05) | S~M | `AuditSourceFields.tsx`, `main.py` |
| 결과 등급 문구 3종 매핑(F-17) | S | `schemas.py`, `AuditReport.tsx` |
| 규칙별 상태에 미지원 10유형 노출 | S | `quality.py`, `AuditReport.tsx` |
| Rule Engine DA-04 오탐(FP 18) 정리, radio/toggle 처리 | M | `checks.py:113-129` |
| 합성 데이터에 대출·투자 업권 추가(F-24) | L | `data/generator/flows/` |
| PDF 서버 생성/공유 링크(F-30) | M | 신규 |

### 6.3 이후 로드맵
| 항목 | 량 | 관련 |
| --- | --- | --- |
| 나머지 미지원 유형(DA-01,02,05,06,08,09,10,11) | L | `checks.py`, 프롬프트 |
| 화면 수·클릭 수·반복 횟수 체크(DA-01/06/09/11) | L | `rule_engine/`, `explorer.py` |
| 독립 라벨 검수·Human Review 일치도·검수시간 측정(F-28) | L | `docs/labeling_guide.md` |
| 이미지 입력용 UI 요소 분류기(F-06~08) | L | `ai/vision/ui_parser.py` |
| CD·평가 CI, 변경 후 자동 재점검 | M~L | `.github/workflows/` |
| Figma OAuth, iOS 캡처 | L | `figma_client.py`, `android_runner.py` |

---

## 7. 기획서 대비 변경 사항 (커밋 메시지·주석에서 확인되는 것만)

| 변경 | 이유/근거 |
| --- | --- |
| 자동 분석 범위를 5종으로 고정 | "전체 유형 검사를 의미하지 않는다" `ai/specs/rule_ai_contract.md`, `ai/README.md` |
| Rule Engine 평가 대상을 MVP 5종으로 정렬(DA-13 제외) | 하이브리드 평가와 집계 기준을 맞추기 위함. DA-13은 오탐이 없어 Rule Engine 수치만 유리해 보임 — `backend/eval_rule_engine.py:31-34`, 커밋 `1595a75` |
| 평가 기준 모델을 `gpt-5.6-luna`로 이동 | 모델별 성능 비교 후 — 커밋 `6028a44` |
| 근거 검증(증거 계약) 도입, 성능 서술 갱신 | 커밋 `57ec857`, `88a3057` |
| DA-07 후보 폭주 수정 | "DA-07 후보가 모든 화면에서 쏟아지던 문제" — 커밋 `6d25907` |
| Figma 인증을 사용자별 OAuth 대신 서버 전역 PAT로 | `.env.example` 주석("지금은 … 하나를 쓴다") |
| 기획서에 없던 RAG 챗봇·데모·결정 메모 추가 | §2 "추가 구현" |
| **기획서 7-2 성능 수치가 stale** | 기획서: Rule Engine P/R/F1 0.27/1.00/0.43, 하이브리드 0.46/1.00/0.63. 현재 JSON: 0.4878/1.0/0.6557, 1.0/0.625/0.7692 (`docs/eval/*.json`). 갱신 누락 [추정: 이후 수정이 반영 안 됨] |
| 집계 단위 차이 | Rule Engine=(rule, screen) 단위 정답 20건, Hybrid=flow 내 규칙 존재 단위 정답 16건 — 직접 비교 금지(`eval_rule_engine.py:38-48`, `evaluator.py:65-79`) |

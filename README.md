# DarkAudit

생성형 AI로 금융상품 가입 화면의 다크패턴을 점검하는 UX 컴플라이언스 도구입니다.
금융위원회 「온라인 금융상품 판매 관련 다크패턴 가이드라인」(2025.12)의 4개 범주,
15개 세부 유형을 기계 판독 가능한 규칙으로 관리하고, 여러 화면으로 이루어진 가입 흐름을
분석해 위험 요소와 개선 권고안을 제공합니다.

2026 금융 AI Challenge 출품작입니다.

## 현재 구현 범위

- React 기반 Audit 생성 및 결과 검토 화면
- FastAPI 기반 Audit 생성, 화면 업로드, URL 캡처, Figma 임포트, 분석 작업 조회,
  Finding 상태 변경, Audit 삭제 API
- OpenAI Responses API를 이용한 멀티모달 분석과 비용 없는 Fake provider
- MVP 규칙 `DA-03`, `DA-04`, `DA-07`, `DA-12`, `DA-15` 탐지
- Rule Engine이 deterministic 후보를 만들고 LLM이 이를 검증하는 Hybrid Pipeline
- 위험 요소의 좌표(`bbox`)와 대립 선택지(`relatedElements`)를 캡처 화면 위에 강조
- 회차(Run) 간 해결·유지·신규·재발을 비교하는 Before/After 회귀 분석 API
- 15개 다크패턴 유형의 YAML Rule Base와 검증/JSON 빌드 도구
- Risky/Clean 쌍으로 구성된 Synthetic UI 데이터셋 생성 및 라벨 검수 도구

### 입력 경로별 차이

| 입력 | 화면 확보 | Rule Engine | LLM이 새로 만들 수 있는 Finding |
| --- | --- | --- | --- |
| URL 캡처 | Playwright 캡처 + DOM 추출 | 후보 생성 | DOM 확보 시 `DA-03`, `DA-12`; DOM 실패 시 시각 모드 5개 규칙 |
| 스크린샷 · Figma · APK | 이미지 + OCR / Figma 노드 / Android XML | 시각 분석 후 좌표 검증 | MVP 5개 규칙; 근거 부족은 별도 표시 |

DOM이 확보된 URL 경로는 deterministic 규칙을 Rule Engine 후보로 다룹니다. 모델이 이 정책을 벗어난
Finding을 내면 해당 항목만 버리고 나머지 판정으로 진행하며, 버린 규칙은 경고 로그와
`last_run_telemetry["dropped_semantic_rule_ids"]`에 남습니다.

이미지 경로의 작은 컨트롤은 모델이 만든 좌표를 그대로 쓰지 않습니다. 한국어/영어 OCR
라벨을 앵커로 삼고 색상·명암·edge·shape 채널에서 후보를 만든 뒤, 확대 crop에 C1, C2…
표식을 붙여 모델이 후보 ID만 고르게 합니다. 최종 bbox는 선택된 CV 후보의 원본 픽셀
좌표를 사용합니다. OCR은 기본적으로 Tesseract(`kor+eng`)를 사용하며 Docker 이미지에는
필요 패키지가 포함되어 있습니다. 로컬에 Tesseract가 없어도 OCR 없는 다중 CV 후보로
계속 분석하고, 명시적으로 끄려면 `DARKAUDIT_OCR_PROVIDER=none`을 설정합니다.

직접 스크린샷 업로드와 모델 요청 한 번의 한도는 **1~5개**입니다. URL은 수집 화면과
페이지 조각을 모두 배치 처리하며, Figma의 프로토타입 분기는 각각 분석합니다.
한도·수집 실패·모의 분석·검사 근거 부족은 결과의 `analysisSummary`에 표시됩니다.
Finding 0건이나 작업 완료 상태만으로 모든 규칙에 문제가 없다는 뜻은 아닙니다.
데이터는 SQLite(`data/darkaudit.db`, `DARKAUDIT_DB_URL`로 변경 가능)에 저장되고
업로드·캡처 이미지는 `data/` 아래에 남습니다. 배포 환경에서 이 경로를 영속 디스크에
연결하지 않으면 재시작할 때 함께 사라집니다.

## 프로젝트 구조

```text
ai/          멀티모달 분석 파이프라인, provider, 스키마, 평가 코드
backend/     FastAPI API와 Audit 실행 오케스트레이션
frontend/    React, TypeScript, Vite 기반 웹 애플리케이션
rules/       15개 유형 Rule Base와 검증/빌드 스크립트
data/        Synthetic UI 생성 설정, 라벨, 검수 도구
docs/        라벨링 가이드와 프로젝트 문서
```

세부 내용은 [AI](ai/README.md), [Backend](backend/README.md),
[Frontend](frontend/README.md), [Dataset Generator](data/generator/README.md) 문서를 참고하세요.
배포 절차는 [배포 가이드](docs/deploy.md), 라벨링 기준은
[라벨링 가이드](docs/labeling_guide.md)에 있습니다.

## 빠른 시작

필요 환경은 Python 3.10 이상과 Node.js 22.22.2+, 24.15.0+ 또는 26+입니다.
CI는 배포 이미지와 같은 Python 3.12 및 Node.js 24.15.0을 사용합니다.

### 1. Python 환경 구성

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

Windows PowerShell:

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

### 2. 백엔드 실행

모델 호출 없이 전체 흐름을 확인하려면 저장소 루트에 `.env`를 만들고 Fake provider를
사용합니다. Fake provider는 이미지에서 의미 Finding을 만들지 않고 URL 후보는 KEEP합니다.
결과에 모의 분석으로 표시되며 실제 탐지 정확도를 검증하는 용도로 사용하지 않습니다.

```dotenv
DARKAUDIT_PROVIDER=fake
```

```bash
python -m uvicorn backend.api.main:app --reload --port 8000
```

`http://localhost:8000/health`에서 상태를, `http://localhost:8000/docs`에서 API 문서를
확인할 수 있습니다.

실제 AI 분석에는 다음 환경 변수가 필요합니다.

```dotenv
DARKAUDIT_PROVIDER=openai
DARKAUDIT_MODEL=YOUR_VISION_CAPABLE_MODEL
OPENAI_API_KEY=YOUR_KEY
```

URL 진단의 `빠른 캡처` 모드는 추가 AI 설정 없이 Playwright로 동작합니다.
`Computer Use`로 흐름을 탐색하는 `스마트 탐색`을 사용하려면 다음 변수도 설정합니다.

```dotenv
DARKAUDIT_COMPUTER_MODEL=YOUR_COMPUTER_USE_MODEL
```

선택한 모델은 Responses API의 이미지 입력과 Structured Outputs를 지원해야 합니다.
`.env.example`을 시작점으로 사용할 수 있으며 `.env`는 Git에 커밋하지 않습니다.

### 3. 프런트엔드 실행

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

브라우저에서 `http://localhost:5173`을 엽니다. 실제 백엔드와 연결하려면
`frontend/.env.local`을 다음과 같이 설정합니다.

```dotenv
VITE_API_BASE_URL=http://localhost:8000
VITE_USE_MOCKS=false
```

`VITE_USE_MOCKS=true`이면 백엔드 없이 브라우저 내 MSW mock API로 화면을 확인할 수
있습니다.

## CLI 분석

웹 애플리케이션을 거치지 않고 이미지 1~5개를 순서대로 분석할 수도 있습니다.
CLI는 OpenAI provider를 사용하며 `{ "output": ..., "telemetry": ... }` JSON을 출력합니다.
판정 계약은 [v1.2 인터페이스](ai/specs/rule_ai_contract.md)를 따릅니다.

```bash
python -m ai.cli audit \
  --image ./screen_01.png --flow-step "상품 안내" \
  --image ./screen_02.png --flow-step "결제"
```

`DARKAUDIT_MODEL`과 `OPENAI_API_KEY`를 설정하거나 모델을 `--model`로 전달해야 합니다.

## Rule Base

`rules/dark_pattern_rules.yaml`이 원본이며 `rules/dark_pattern_rules.json`은 Git에 포함하지
않는 빌드 산출물입니다. 규칙은 YAML에서만 수정한 뒤 검증과 빌드를 실행합니다.

```bash
python rules/build_rules.py --summary
```

빌드 과정은 필수 필드, `rule_id` 중복, 범주별 개수, 결합 규칙 참조 무결성,
단독 판정 불가 규칙의 승격 경로를 검증합니다.

| 구분 | 역할 |
| --- | --- |
| `deterministic_checks` | 선택 상태, 크기비, 대비비, 클릭 수, 가격 변화 등 코드로 계산 가능한 신호 |
| `semantic_checks` | 의미, 맥락, 시각적 위계의 함의 등 멀티모달 모델이 해석하는 신호 |

`standalone_sufficient: false`인 `DA-09`, `DA-12`, `DA-13`, `DA-14`는 단독으로 HIGH를
부여하지 않고 다른 행위와의 결합 여부를 함께 판단합니다.

## 탐지 성능

합성 데이터 22개 Flow(110화면, Risky/Clean 쌍)로 측정했습니다. Rule Engine 단독 성능과
LLM 검증까지 붙인 하이브리드 성능을 나란히 재서, 검증 단계가 실제로 기여하는지 확인합니다.

| 단계 | Precision | Recall | F1 |
| --- | --- | --- | --- |
| Rule Engine 단독 | 0.27 | 1.00 | 0.43 |
| **하이브리드 (LLM 검증 후)** | **0.40** | **1.00** | **0.57** |

**미탐 0을 유지한 채 정밀도가 0.27에서 0.40으로 올랐습니다.** Rule Engine이 후보를 넓게
만들고 멀티모달 모델이 걸러내는 설계가 의도대로 동작합니다. 규제 준수 도구에서는 미탐이
오탐보다 치명적이므로 재현율을 우선했습니다.

유형별 하이브리드 성능(3회 평균)입니다.

| Rule | Precision | Recall | F1 |
| --- | --- | --- | --- |
| `DA-03` 잘못된 계층구조 | 1.00 | 1.00 | 1.00 |
| `DA-12` 감정적 언어 | 1.00 | 1.00 | 1.00 |
| `DA-15` 순차공개 가격책정 | 1.00 | 1.00 | 1.00 |
| `DA-07` 방해되는 절차 | 0.25 | 1.00 | 0.40 |
| `DA-04` 특정옵션의 사전선택 | 0.21 | 1.00 | 0.35 |

3종은 오탐 없이 완벽하고, `DA-04`·`DA-07`이 평균을 끌어내립니다. 이 둘은 deterministic
check가 아직 구현되지 않아(선언 55개 중 11개 구현) 후보가 과하게 생성되며, LLM 검증도
전부 걸러내지 못합니다. **다음 단계의 우선 개선 지점입니다.**

부가 지표: 위치 정확도 IoU 0.5 기준 성공률 **1.00**(mean IoU 1.00), 화면 5장 기준 평균
응답 **5.9초**, 스키마 재시도율 **8.3%**, Counterfactual 일관성 **0.71**.

### 한계

LLM은 같은 입력에도 매번 다르게 답합니다. 위 값은 **3회 측정 평균이며 F1 범위는
0.542~0.582**입니다. 단일 측정값이 아니라는 점을 밝혀 둡니다. Gold Set 기반 2차 라벨링과
라벨러 간 일치도 산출은 아직 하지 않았으므로, 정답 라벨은 생성기가 심은 패턴을 기준으로
합니다.

전체 수치는 [rule_engine_report.json](docs/eval/rule_engine_report.json),
[hybrid_report.json](docs/eval/hybrid_report.json)에 있습니다.

### 재현

합성 데이터는 생성물이라 저장소에 없습니다. 먼저 생성해야 합니다.

```bash
cd data/generator
python generate.py --config configs/ins-001-risky.json   # 전체는 configs/*.json 반복
python capture.py  --config configs/ins-001-risky.json
python extract_ui.py --all

cd ../../backend
python eval_rule_engine.py          # Rule Engine 단독
python eval_hybrid.py --runs 3      # 하이브리드 (실제 모델 호출, OPENAI_API_KEY 필요)
```

## 검증

저장소 루트에서 Python 테스트를 실행합니다.

```bash
python -m unittest discover -s ai/tests -v
python -m unittest discover -s backend/tests -v
```

프런트엔드 검증은 `frontend/`에서 실행합니다.

```bash
npm run lint
npm run test
npm run build
```

Playwright 브라우저를 설치한 환경에서는 E2E와 접근성 테스트도 실행할 수 있습니다.

```bash
npx playwright install chrome
npm run test:e2e
npm run test:a11y
```

E2E는 `--mode e2e`로 dev 서버를 띄워 `frontend/.env.e2e`를 적용합니다. 목업 API와
목업 스크린샷만 사용하므로 개발자의 로컬 `.env` 설정이나 백엔드 상태에 영향을 받지
않습니다. 화면을 바꾼 뒤 visual 스냅샷을 갱신하려면 `npm run test:e2e:update`를
실행합니다.

## 배포

백엔드는 Render(Docker), 프런트엔드는 Vercel에 배포합니다. 순서와 환경 변수는
[docs/deploy.md](docs/deploy.md)를 따르며, 요약하면 다음과 같습니다.

- 백엔드를 먼저 배포해 URL을 얻고, 그 값을 프런트엔드의 `VITE_API_BASE_URL`에 넣습니다.
- 프런트엔드는 Root Directory를 `frontend`로 지정하고 `VITE_USE_MOCKS=false`를 설정합니다.
- `data/`를 영속 디스크에 연결해야 진단 기록과 캡처 이미지가 재배포 후에도 남습니다.

CORS는 `*.vercel.app` 서브도메인을 정규식으로 허용하므로 프리뷰 배포마다 설정을 바꿀
필요가 없습니다. 커스텀 도메인을 쓸 때만 `DARKAUDIT_CORS_ORIGINS`를 지정합니다.

## 팀

| 담당 | 역할 |
| --- | --- |
| 배소연 | AI Engineer - Multimodal LLM 기반 UX Risk Detection Pipeline |
| 이정현 | Data Engineer - 규제 데이터 Pipeline 및 Backend / Deployment |

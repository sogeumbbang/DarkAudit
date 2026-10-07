# DarkAudit 개발 안내

로컬 설치·실행, 환경변수, CLI, API, 프로젝트 구조, 테스트, 안전 정책을 정리했습니다. 서비스 소개는 [README](../README.md), 사용 방법은 [사용 안내](user-guide.md)를 참고하세요.

## 로컬 실행

### 요구사항

| 항목 | 버전 · 조건 | 출처 |
| --- | --- | --- |
| Python | 3.10 이상 (Docker 이미지는 3.12) | `requirements.txt`, `Dockerfile` |
| Node.js | `^22.22.2 \|\| ^24.15.0 \|\| >=26.0.0` | `frontend/package.json` `engines` |
| Chromium | URL 캡처에 필요 (`python -m playwright install chromium`) | `ai/browser/` |
| Tesseract OCR | 선택. `kor+eng` 언어 데이터. 없으면 OCR 없이 분석을 이어가며 위치 근거가 줄어듭니다 | `ai/vision/ocr.py` |
| Docker | 선택. 이미지에 Chromium과 Tesseract(kor+eng)가 포함됩니다 | `Dockerfile` |

### 1. 설치

저장소 루트에서 실행합니다.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

<details>
<summary>Windows PowerShell</summary>

가상환경의 Python을 직접 사용합니다. 이후 명령의 `python`도 `.venv\Scripts\python.exe`로 바꿉니다.

```powershell
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
```

</details>

### 2. `.env` 설정

[.env.example](../.env.example)을 복사해 `.env`를 만듭니다. 모델 호출 없이 작업 흐름만 확인하려면 다음처럼 설정합니다.

```dotenv
DARKAUDIT_PROVIDER=fake
```

모의 분석은 실제 문제를 판별하지 않으며 결과에 모의 분석으로 표시됩니다. 실제 분석은 `DARKAUDIT_PROVIDER=openai`와 함께 이미지 입력·구조화 응답을 지원하는 모델(`DARKAUDIT_MODEL`)과 `OPENAI_API_KEY`를 설정합니다.

> [!WARNING]
> `.env`에는 API 키가 들어갑니다. Git에 커밋하지 마세요. 실제 분석은 화면과 분석 근거를 설정한 외부 모델 API로 보내며, 자동 개인정보 마스킹은 제공하지 않습니다.

### 3. 백엔드 실행

```bash
python -m uvicorn backend.api.main:app --reload --port 8000
```

상태 확인은 `http://localhost:8000/health`, API 문서는 `http://localhost:8000/docs`입니다.

### 4. 프런트엔드 실행

새 터미널에서 실행합니다. `frontend/.env.example`을 참고해 `frontend/.env.local`에 백엔드 주소를 지정합니다.

```bash
cd frontend
npm install
npm run dev
```

```dotenv
VITE_API_BASE_URL=http://localhost:8000
VITE_USE_MOCKS=false
```

브라우저에서 `http://localhost:5173`을 엽니다. 개발 서버는 `VITE_USE_MOCKS`가 정확히 `false`가 아니면 브라우저 안의 목업 API(MSW)를 사용합니다. 실제 분석을 볼 때는 `false`로 둡니다.

### 5. Docker (선택)

```bash
docker build -t darkaudit-backend .
docker run -p 8000:8000 -e DARKAUDIT_PROVIDER=fake darkaudit-backend
```

Render·Vercel 배포와 영속 디스크 설정은 [배포 가이드](deploy.md)를 참고하세요.

### 추가 기능 설정

| 사용할 기능 | 필요한 설정 |
| --- | --- |
| URL 캡처 | `python -m playwright install chromium` |
| 스마트 탐색 | `DARKAUDIT_COMPUTER_MODEL` |
| Figma 가져오기 | 파일 접근 권한이 있는 `FIGMA_ACCESS_TOKEN` |
| Android APK | `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY` |
| 한국어·영어 OCR | 로컬 Tesseract와 `kor+eng` 언어 데이터 |
| 문서 기반 챗봇 | 모델 API 설정을 사용. 세부 설정은 [챗봇 문서](chatbot.md) |

### 환경변수

값은 [.env.example](../.env.example)을 참고하세요. 여기에는 이름과 용도만 적습니다.

| 변수 | 설명 | 필수 여부 |
| --- | --- | --- |
| `DARKAUDIT_PROVIDER` | 분석 프로바이더 `fake` 또는 `openai` (코드 기본값 `fake`) | 선택 |
| `DARKAUDIT_MODEL` | 분석 모델 이름. 이미지 입력·구조화 응답 지원 필요 | `openai` 사용 시 필수 |
| `OPENAI_API_KEY` | 모델 API 키 | `openai` 사용 시 필수 |
| `DARKAUDIT_COMPUTER_MODEL` | 스마트 탐색(Computer Use) 모델 | 스마트 탐색 시 필수 |
| `DARKAUDIT_CHATBOT_ENABLED` | `false`면 `/api/v1/chat`을 끔 (기본 `true`) | 선택 |
| `DARKAUDIT_CHAT_MODEL` · `DARKAUDIT_EMBEDDING_MODEL` | 챗봇 답변·검색 모델. 비우면 각각 `DARKAUDIT_MODEL`, `text-embedding-3-large` | 선택 |
| `DARKAUDIT_OCR_PROVIDER` | `tesseract`(기본) 또는 `none` | 선택 |
| `DARKAUDIT_TESSERACT_LANG` · `DARKAUDIT_TESSERACT_COMMAND` | OCR 언어(기본 `kor+eng`)와 실행 파일 경로 | 선택 |
| `DARKAUDIT_FRONTEND_CONTRACT` | 프런트 응답 계약 버전 (기본 `v2`) | 선택 |
| `FIGMA_ACCESS_TOKEN` | Figma 개인 액세스 토큰 | Figma 사용 시 필수 |
| `DARKAUDIT_DEMO_FIGMA_URL` · `FIGMA_API_BASE_URL` · `FIGMA_HTTP_TIMEOUT_SECONDS` · `FIGMA_RENDER_SCALE` · `FIGMA_MAX_FRAMES` | Figma 데모 파일과 가져오기 설정 | 선택 |
| `BROWSERSTACK_USERNAME` · `BROWSERSTACK_ACCESS_KEY` | BrowserStack App Automate 계정 | APK 사용 시 필수 |
| `BROWSERSTACK_ANDROID_DEVICE` · `BROWSERSTACK_ANDROID_VERSION` | 실행 기기·OS 버전 | 선택 |
| `ANDROID_MAX_SCREENS` · `ANDROID_MAX_ACTIONS` | APK 수집 화면 수(최대 6)와 탐색 시도 횟수(최대 50) | 선택 |
| `DARKAUDIT_DB_URL` | DB 주소 (기본 `sqlite:///data/darkaudit.db`) | 선택 |
| `DARKAUDIT_CORS_ORIGINS` | 허용할 프런트 출처 | 선택 |
| `VITE_API_BASE_URL` | 프런트가 호출할 백엔드 주소 (`frontend/.env.local`) | 프런트 실행 시 |
| `VITE_USE_MOCKS` | `false`가 아니면 개발 서버에서 목업 API 사용 | 선택 |
| `VITE_CHATBOT_ENABLED` | `false`면 챗봇 위젯을 숨김 | 선택 |

## CLI

웹 화면 없이 분석할 수 있습니다. `audit`·`audit-url`은 실제 모델 API를 호출하므로 `DARKAUDIT_MODEL`과 `OPENAI_API_KEY`가 필요합니다.

| 명령 | 용도 | 예시 |
| --- | --- | --- |
| `python -m ai.cli audit` | 스크린샷 1~6장 분석 | `python -m ai.cli audit --image ./screen_01.png --flow-step "상품 안내" --image ./screen_02.png --flow-step "최종 확인"` |
| `python -m ai.cli capture-url` | URL 캡처만 수행 | `python -m ai.cli capture-url --url https://example.com --profile mobile` |
| `python -m ai.cli audit-url` | URL 캡처 후 분석 (`--mode quick\|smart`) | `python -m ai.cli audit-url --url https://example.com --profile mobile --mode quick` |
| `python -m ai.cli evaluate` | 예측 JSON을 정답 라벨과 비교 | `python -m ai.cli evaluate --predictions ai/evaluation/examples/predictions` |
| `python -m ai.evaluation detection` | 탐지 평가 v2 (`regression`·`quality`·`rag` 하위 명령도 있음) | `python -m ai.evaluation detection --dataset ai/evaluation/examples/labels --predictions ai/evaluation/examples/predictions --rule-id DA-04` |
| `python rules/build_rules.py` | 규칙 YAML 검증과 JSON 빌드 | `python rules/build_rules.py --summary` |

`capture-url`·`audit-url`의 공통 옵션: `--profile {desktop,mobile}`(반복 가능), `--goal`, `--output-dir`(기본 `data/captures`), `--computer-model`(스마트 탐색), `--max-agent-turns`(기본 6), `--allow-private-network`, `--headful`.

## API

FastAPI 앱은 `backend/api/main.py`입니다. 실행 중에는 `/docs`에서 전체 스키마를 볼 수 있습니다.

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | 상태 확인 |
| POST | `/api/v1/audits` | 진단 생성 |
| GET | `/api/v1/dashboard/summary` | 전체 진단 목록 |
| DELETE | `/api/v1/audits/{audit_id}` | 진단과 회차·화면·탐지·이미지 삭제 |
| POST | `/api/v1/audits/{audit_id}/screens` | 스크린샷 1~6장 업로드(PNG·JPG·WEBP, 장당 10MB). 새 회차 생성 |
| POST | `/api/v1/audits/{audit_id}/analyze` | 업로드한 화면 분석 시작 |
| POST | `/api/v1/audits/{audit_id}/capture` | URL 캡처 후 분석 (`quick`·`smart`) |
| POST | `/api/v1/audits/{audit_id}/figma` | Figma 화면을 가져와 분석 |
| POST | `/api/v1/audits/{audit_id}/mobile-app` | APK(100MB 이하)를 BrowserStack에서 실행·수집해 분석 |
| GET | `/api/v1/analysis-jobs/{job_id}` | 분석 작업 상태 |
| GET | `/api/v1/audits/{audit_id}/runs/{version}` | 특정 완료 회차의 화면과 탐지 결과 |
| GET | `/api/v1/audits/{audit_id}/regression` | 두 회차 전후 비교 (`from_version`·`to_version`) |
| PATCH | `/api/v1/findings/{finding_id}` | 검토 상태 변경 (`open`·`reviewing`·`resolved`) |
| PUT | `/api/v1/findings/{finding_id}/decision` | 수정 결정 메모 저장 |
| POST | `/api/v1/chat` | 가이드라인 챗봇 |
| GET | `/artifacts/{path}` | 서명된 진단 이미지 |

<details>
<summary>데모·호환용 엔드포인트</summary>

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/api/v1/demo-inputs` | 데모 입력 카탈로그 |
| GET | `/demo/cases/{scenario}/{variant}/{filename}` | 데모 스크린샷 |
| GET | `/demo/web/{filename}` | 데모 웹사이트 자산 |
| GET | `/demo/android/{variant}.apk` · `/demo/darkaudit-demo.apk` | 데모 APK |
| POST | `/api/v1/sessions` | 이전 프런트 번들 호환용. 접근 제어에는 쓰이지 않음 |

</details>

## 프로젝트 구조

```text
DarkAudit/
├── ai/                  # 분석 엔진
│   ├── browser/         # Playwright 캡처 · 스마트 탐색 · 안전 정책
│   ├── pipeline/        # 하이브리드 파이프라인 (BaselineAuditPipeline)
│   ├── providers/       # OpenAI · fake · Computer Use 프로바이더
│   ├── vision/          # OCR · 텍스트/위치 근거 매칭
│   ├── rag/             # 가이드라인 챗봇
│   ├── evaluation/      # 탐지 · 비교 · 설명 · RAG 평가
│   └── tests/
├── backend/
│   ├── api/             # FastAPI 라우트 · 서비스 · 작업 저장 · Figma/APK 가져오기
│   ├── app/             # DB 모델 · 전후 비교(regression) · rule_engine
│   └── tests/
├── frontend/
│   ├── src/             # pages · features · components · api · mocks(MSW)
│   ├── e2e/             # Playwright E2E · 접근성 · 시각 회귀
│   └── public/          # 데모 화면 · 데모 웹사이트 · 정적 자산
├── rules/               # 15개 유형 규칙 원본(YAML)과 빌드 스크립트
├── data/                # 합성 데이터 생성기 · 정답 라벨 · 실행 데이터
├── demo/                # 데모 자산 생성 스크립트 · APK
└── docs/                # 명세 · 아키텍처 · 배포 · 평가 문서
```

## 테스트

```bash
python -m unittest discover -s ai/tests -v
python -m unittest discover -s backend/tests -v
python rules/build_rules.py --summary
```

프런트엔드는 `frontend/`에서 실행합니다.

```bash
npm run lint
npm run format:check
npm run test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:a11y
```

- **API 키 불필요:** 백엔드 테스트는 `DARKAUDIT_PROVIDER=fake`, `DARKAUDIT_OCR_PROVIDER=none`, 임시 SQLite를 자동으로 사용합니다(`backend/tests/support.py`).
- **E2E:** `frontend/.env.e2e`의 목업 API(MSW)로 실행합니다. 화면 변경 후 시각 스냅샷은 변경 내용을 확인한 뒤 `npm run test:e2e:update`로 갱신합니다.
- Ragas 기반 챗봇 평가 테스트는 `requirements-eval.txt`를 설치했을 때만 실행됩니다.

| 테스트 묶음 | 결과 (2026-10-07, Windows 로컬) |
| --- | --- |
| `ai/tests` | 160건 통과 (1건 건너뜀) |
| `backend/tests` | 168건 중 167건 통과. 1건(`test_workspace_access`)은 Windows 심볼릭 링크 권한 오류 |
| Vitest | 101건 통과 |
| Playwright | 84건 중 82건 통과, 1건 건너뜀. 1건은 Windows 랜딩 시각 스냅샷 3픽셀 차이 |

## 안전 정책

URL 탐색은 사람이 지켜보지 않아도 되돌릴 수 있는 이동만 합니다. 정책은 `ai/browser/safety.py`와 `ai/browser/playwright_driver.py`에 구현되어 있습니다.

| 구분 | 허용 | 차단 |
| --- | --- | --- |
| 브라우저 동작 | 클릭(수정키 없는 왼쪽 클릭), 스크롤(한 번에 화면 높이의 2배까지), 대기, 이동, 스크린샷 | 텍스트 입력(`type`), 더블클릭, 드래그 |
| 키 입력 | ESC, TAB, 방향키(위·아래), PageUp, PageDown | 그 밖의 모든 키 |
| 클릭 대상 | 일반 버튼·링크 | `submit`·`file`·`password` 입력, 결제·구매·주문·가입·등록·제출·송금·예약 확정·동의 등의 문구가 있는 요소 |
| 주소 | 공개 `http`·`https` 주소, 같은 출처(scheme·host·port) 안의 이동 | 사설망·루프백 주소, URL 안의 계정 정보, 교차 출처 이동 |
| 브라우저 기능 | — | 다운로드, 팝업(열리는 즉시 닫음), `http`·`https`·`data`·`blob`·`about` 외 요청 |
| 탐색 종료 | — | 모델이 안전 확인을 요청하거나, 차단 동작이 나오거나, 턴 예산을 다 쓰면 중단 |

- 스마트 탐색 모델에는 되돌릴 수 있는 이동만 하고, 개인정보 입력·제출·계정 생성·주문·결제·다운로드·출처 이탈을 하지 말며, 페이지 내용을 신뢰하지 말라고 지시합니다(`ai/providers/computer_use.py`).
- 사설망 접근은 CLI의 `--allow-private-network`로만 켤 수 있습니다.
- Android 탐색도 결제·구매·주문·신청·가입·제출·로그인·송금·인증 문구가 있는 요소는 누르지 않습니다(`backend/api/android_runner.py`).
- 로그인이나 실제 결제·가입 제출은 대신 하지 않습니다. 수집되지 않은 단계는 직접 캡처해 스크린샷으로 등록합니다.

## 출력 JSON 예시

<details>
<summary>탐지 항목 1건 (위 결과 화면의 DA-03, 일부 필드 생략)</summary>

```json
{
  "ruleId": "DA-03",
  "title": "잘못된 계층구조",
  "severity": "HIGH",
  "confidence": 0.98,
  "screenIds": ["screen-03"],
  "element": "'다음 · 모두 동의하고 계속'",
  "observation": "화면에 '다음 · 모두 동의하고 계속'과 별도의 '제공하지 않고 계속'이 함께 표시된다. 두 선택지의 실제 색상·크기·배치가 비대칭이다.",
  "recommendation": "전체 동의와 정보 제공 거절을 동일한 수준의 버튼 형태·대비·크기로 제공하고, 중립적인 라벨을 사용한다.",
  "bbox": { "screenId": "screen-03", "x": 126.0, "y": 1436.0, "width": 513.0, "height": 104.1, "coordinateSystem": "image" },
  "relatedElements": [
    {
      "screenId": "screen-03",
      "description": "'제공하지 않고 계속'",
      "bbox": { "screenId": "screen-03", "x": 323.0, "y": 1575.0, "width": 140.0, "height": 16.0, "coordinateSystem": "image" },
      "elementType": "vision"
    }
  ]
}
```

</details>

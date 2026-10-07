# 배포 가이드 (Render + Vercel)

> 저장소 설정 기준 · 2026-10-08 · 운영 서비스 상태는 이번 개정에서 확인하지 않음

백엔드는 Render에 Docker로, 프런트엔드는 Vercel에 배포한다. 둘 다 GitHub 저장소를
연결해 두면 `main`에 머지할 때마다 자동 배포된다.

## 순서 (역방향 의존성이 있어 이 순서를 지켜야 한다)

1. **백엔드(Render)를 먼저 배포**해서 URL을 받는다.
2. 그 URL을 **프런트(Vercel) 환경변수**에 넣고 배포한다.

예전 문서에 있던 "프런트 URL을 다시 CORS에 넣는" 3단계는 이제 필요 없다. 백엔드가
`*.vercel.app` 서브도메인을 정규식으로 허용하므로 프리뷰 배포 URL이 매번 바뀌어도
그대로 동작한다. 커스텀 도메인을 붙일 때만 `DARKAUDIT_CORS_ORIGINS`에 그 주소를 넣는다.

## 1. 백엔드 — Render

1. https://render.com 가입 후 **New +** → **Web Service**.
2. **GitHub 계정을 연동해서** `sogeumbbang/DarkAudit`을 선택한다.
   - Runtime은 **Docker**, Dockerfile 경로는 `./Dockerfile` (레포 루트).
   - 계정 연동 없이 "Public Git Repository" URL만 넣는 방법도 되지만, 그러면 webhook이
     없어 push해도 자동 배포되지 않는다. 반영하려면 매번 **Manual Deploy → Deploy
     latest commit**을 눌러야 하므로 권장하지 않는다.
3. 환경변수를 채운다.

   | 변수 | 필요 여부 | 설명 |
   | --- | --- | --- |
   | `DARKAUDIT_PROVIDER` | 필수 | 실제 분석은 `openai`. `fake`면 모델 호출 없이 흐름 확인. 이미지 분석은 0건이며 DOM 후보는 KEEP될 수 있음 |
   | `DARKAUDIT_MODEL` | 필수 | Responses API의 이미지 입력과 Structured Outputs를 지원하는 모델 |
   | `OPENAI_API_KEY` | 필수 | |
   | `DARKAUDIT_CHATBOT_ENABLED` | 선택 | 기본 `true`. `false`면 다크패턴 챗봇 API를 끈다([chatbot.md](chatbot.md)) |
   | `DARKAUDIT_CHAT_MODEL` | 선택 | 다크패턴 챗봇 답변 모델. 비우면 `DARKAUDIT_MODEL`을 쓴다 |
   | `DARKAUDIT_EMBEDDING_MODEL` | 선택 | 챗봇 문서 검색용 임베딩 모델. 기본값 `text-embedding-3-large` |
   | `DARKAUDIT_COMPUTER_MODEL` | 선택 | URL `스마트 탐색` 모드에만 필요. 없으면 그 요청은 400으로 거절된다 |
   | `FIGMA_ACCESS_TOKEN` | 선택 | Figma 임포트용. `file_content:read` 권한만 있으면 된다 |
   | `BROWSERSTACK_USERNAME` | APK 사용 시 필수 | BrowserStack App Automate 사용자명 |
   | `BROWSERSTACK_ACCESS_KEY` | APK 사용 시 필수 | BrowserStack App Automate access key |
   | `BROWSERSTACK_ANDROID_DEVICE` | 선택 | 기본값 `Google Pixel 8` |
   | `BROWSERSTACK_ANDROID_VERSION` | 선택 | 기본값 `14.0` |
   | `ANDROID_MAX_SCREENS` | 심사용 `6` | 기존 값이 `5`이면 6단계 APK 데모가 최종 이용료 전에 종료된다 |
   | `ANDROID_MAX_ACTIONS` | 심사용 `20` | 화면 수와 별개인 탐색 동작 한도 |
   | `DARKAUDIT_CORS_ORIGINS` | 선택 | 커스텀 도메인을 쓸 때만. 비워도 `*.vercel.app`은 허용된다 |
   | `DARKAUDIT_FRONTEND_CONTRACT` | 선택 | 기본값 `v2`(전체 개방). 프런트가 모르는 값을 막아야 할 때만 `v1`로 내린다 |
   | `PROTECTED_AUDIT_IDS` | 심사용 `audit-47` | 화면·API에서 삭제를 막을 진단 ID(쉼표 구분). 비우면 모든 진단을 지울 수 있다. [데모 진단 관리](#데모-진단-관리) 참고 |

4. **디스크를 붙인다.** 대시보드 → **Disks → Add Disk**, Mount Path를
   **`/app/data`** 로 지정한다(보관할 이미지·APK 용량에 맞춰 크기 선택).

   이걸 빼면 재배포·재시작할 때마다 진단 기록과 캡처 이미지가 전부 사라진다.
   SQLite(`data/darkaudit.db`)와 업로드·캡처 산출물이 모두 이 경로 아래에 있다.
   작업 기록(`data/jobs.sqlite3`)도 같은 디스크에서 보존한다.
   `render.yaml`에는 디스크가 선언되어 있지 않으므로 저장소 설정만으로 영속성이
   확보되었다고 판단하면 안 된다. 배포 서비스에서 영속 디스크 연결을 확인한다.

   현재 작업 실행기는 단일 Uvicorn 프로세스를 전제로 한다. `--workers`를 늘리지 않는다.
   재시작 시 실행 중이던 작업은 중단 상태로 정리하며, 기존 작업 URL에서 기록과 이유를
   조회할 수 있다. 여러 실행기나 자동 재개가 필요하면 별도 작업 큐와 실행기 임대가 필요하다.

   로컬 `.env` 수정은 Render 환경변수를 바꾸지 않는다. 배포 담당자는 Render의
   Environment에서 `ANDROID_MAX_SCREENS=6`, `ANDROID_MAX_ACTIONS=20`을 적용하고
   재배포해야 한다. `render.yaml`에도 같은 값을 명시했지만, 대시보드에서 따로 관리하는
   기존 서비스는 저장소 파일 수정만으로 환경변수가 바뀌지 않을 수 있다.

5. 배포가 끝나면 `https://<서비스명>.onrender.com` URL이 생긴다. **이 URL을 적어둔다.**
6. `curl https://<서비스명>.onrender.com/health`로 `status: "ok"`와 `commit`을 확인한다.
   Render가 주입하는 `RENDER_GIT_COMMIT`을 반환하므로 로컬 `git rev-parse HEAD`와
   대조할 수 있다. 자동 배포가 켜져 있어도 빌드가 실패하면 이전 버전이 계속 서비스된다.

프런트는 진단 생성과 데모 목록 조회 전에 `/health`를 최대 120초 기다린다.
서버 준비 요청만 재시도하며, 진단 생성 POST를 자동으로 중복 실행하지 않는다.

## 2. 프런트 — Vercel

1. https://vercel.com 가입 → GitHub 연결 → 저장소 Import.
2. **Root Directory를 `frontend`로 지정한다.** 이걸 빼면 Vercel이 레포 루트를 스캔하다
   Python 파일을 발견하고 FastAPI 프로젝트로 배포하려다 실패한다
   (`No FastAPI entrypoint found in default locations`). 나머지 빌드 설정은 Vercel이
   Vite를 자동 인식하므로 건드리지 않아도 된다.
3. 환경변수를 추가한다.

   | 변수 | 값 |
   | --- | --- |
   | `VITE_API_BASE_URL` | 1단계에서 받은 Render URL (끝에 슬래시 없이) |
   | `VITE_USE_MOCKS` | `false` |
   | `VITE_CHATBOT_ENABLED` | 선택. `false`면 챗봇 위젯을 숨긴다 |

   `VITE_USE_MOCKS=true`이면 목업 모드로 떠서 백엔드를 타지 않는다.
   심사용 배포는 반드시 `false`로 설정하고 Network에서 Render API 요청을 확인한다.

   `VITE_API_BASE_URL`이 없으면 프로덕션 빌드는 `client.ts`의 `DEPLOYED_API_BASE_URL`로
   넘어간다. 안전망이지만 백엔드 서비스명을 바꾸면 같이 고쳐야 한다. 값이 틀리면 빌드는
   통과하고 배포된 앱만 죽은 주소를 향하므로, 환경변수를 명시하는 쪽이 확실하다.

4. Deploy. 끝나면 `https://<프로젝트명>.vercel.app` URL이 생긴다.
5. **Settings → Domains**에서 프로덕션 도메인을 확인한다. 제출·공유에는 이 주소를 쓴다.
   프리뷰 URL(`...-git-...vercel.app`)은 커밋마다 바뀐다.

## 배포 후 확인

1. 프로덕션 `/landing` → 새 진단 화면을 연다.
2. `/api/v1/demo-inputs`에 세 시나리오의 `cases`와 세 가지 버전이 있는지,
   `/demo/cases/pet/revised/01.png`가 실제 PNG로 응답하는지 확인한다.
3. Figma·APK·URL·스크린샷 데모를 각각 실행한다. 작업의 `completed` 상태뿐 아니라
   결과 화면의 캡처 이미지가 로드되고, 6단계 데모의 마지막 금액 화면까지 수집됐는지 확인한다.
4. 스크린샷·URL 데모의 수정본을 실행한다. 같은 진단에 다음 회차가 추가되고,
   이전 회차의 이미지 내용이 유지돼야 한다. 서명된 URL의 만료 시각·서명 값은 조회 시 바뀔 수 있다. 비교 화면에서 원본과 최신 수정본을 기본으로 표시하고 기준·대상 회차 선택과 비교 PDF도 확인한다.
5. 새로고침 후 진단 기록·결과·이미지가 유지되고 CORS 오류가 없는지 확인한다.

### Docker 데모 파일 누락 검사

`Dockerfile`의 `COPY`만 추가해도 `.dockerignore`에서 제외한 파일은 복사할 수 없다.
특히 `frontend/public/*` 제외 규칙 아래에 `demo-cases/` 예외가 필요하다.
배포 전에 다음 명령으로 실제 빌드 컨텍스트의 웹·스크린샷·APK 파일을 확인한다.
현재 Git 추적 파일에는 GitHub Actions 워크플로가 없으므로 아래 명령으로 직접 검사하거나 별도 CI에 연결한다.

```bash
docker build --file demo/Dockerfile.assets-check --tag darkaudit-assets-check .
```

URL 캡처는 `data/captures/{audit_id}/run-{run_id}/{profile}/` 아래에 저장한다.
스마트 탐색은 최대 12회 모델 응답을 처리하며, 한도에 도달한 경우 수집한 범위만
검사한다. 분석 완료가 해당 사이트의 모든 화면을 검사했다는 뜻은 아니다.

실패하면 Render 대시보드 → **Logs**에서 원인을 본다. `_fail_job()`이 기록한 메시지는
`GET /api/v1/analysis-jobs/{id}`의 `error` 필드에도 그대로 나온다.

## 로컬에서 이미지만 먼저 확인하고 싶을 때

```bash
docker build -t darkaudit-backend .
docker run -p 8000:8000 -e DARKAUDIT_PROVIDER=fake darkaudit-backend
curl http://localhost:8000/health
```

`DARKAUDIT_PROVIDER=fake`면 모델 호출 없이 흐름을 확인한다. 후보 없는 이미지 분석은 0건이며 DOM 규칙 후보가 전달되면 KEEP하므로 탐지 항목이 나올 수 있다. 실제 품질 측정으로 사용하지 않는다.
실제 모델 응답까지 보려면 `openai`로 바꾸고 `DARKAUDIT_MODEL`/`OPENAI_API_KEY`를 같이
넘긴다.

## 데모 진단 관리

평가자가 함께 보는 대표 데모 진단만 삭제를 막는다. 대상은 환경변수
`PROTECTED_AUDIT_IDS`로 지정하며, 여기에 든 진단은 진단 기록 화면의 삭제 버튼이 잠기고
("대표 데모 진단은 삭제할 수 없습니다" 툴팁) `DELETE /api/v1/audits/{audit_id}`도 403으로
거부한다. 그 밖의 진단은 데모 버튼으로 만든 것이라도 화면과 API에서 지울 수 있다.

### 보호 목록 설정

Render 대시보드 → 서비스 → **Environment**에서 값을 넣고 저장한다(저장하면 재배포된다).

```text
PROTECTED_AUDIT_IDS=audit-47
```

- 쉼표로 여러 개를 넣을 수 있다: `audit-47,audit-52`. 숫자만 써도(`47`) 같다.
- 기본값은 비어 있다. 비워 두면 보호되는 진단이 없으며 진행 중 작업이 없는 진단을 지울 수 있다(로컬 개발 기본값).
- 값은 요청마다 읽지만 Render는 환경변수를 바꾸면 재시작하므로 저장 후 배포가 끝날 때까지 기다린다.
- `render.yaml`에도 같은 값을 적어 두었지만, 대시보드에서 관리하는 기존 서비스는
  저장소 파일만으로 바뀌지 않을 수 있으므로 대시보드 값을 확인한다.
- 확인: `curl https://<서비스명>.onrender.com/api/v1/dashboard/summary`에서 대상 진단의
  `deletionProtected`가 `true`인지 본다.

### 관리용 삭제 스크립트

진단을 서버에서 정리할 때는 Render 대시보드 → **Shell**에서 관리용 스크립트를 실행한다.
이 스크립트는 API·화면에 노출되지 않는다. 보호된 진단은 `--force`를 함께 붙여야 지운다.

```bash
# dry-run: 이름·회차·데모·보호 여부만 출력하고 지우지 않는다
python -m backend.admin_delete_audit audit-46

# 확인한 뒤 실제로 지운다 (DB 기록, 업로드·캡처 파일, 작업 기록)
python -m backend.admin_delete_audit audit-46 --apply

# 보호된 진단(PROTECTED_AUDIT_IDS)은 --force 가 있어야 지운다
python -m backend.admin_delete_audit audit-47 --apply --force
```

진단 ID는 여러 개를 한 번에 넘길 수 있다. 검사가 진행 중인 진단은 건너뛴다.
보호 진단을 지웠다면 `PROTECTED_AUDIT_IDS`에서도 빼거나 새 대표 진단 ID로 바꾼다.

## 알아둘 것

- 계정 구분 없이 모든 방문자가 같은 공용 작업공간을 사용한다. 진단 목록·결과·작업
  이력을 공유하며, 재진단·검토·삭제에도 브라우저 토큰이 필요하지 않다.
- 기존 브라우저별 기록과 소유자 없는 과거 기록도 공용 목록에 표시한다. 기존 소유자
  컬럼은 데이터 호환성을 위해 유지하며 접근 제한에 사용하지 않는다. 시작 시 이미지
  서명 키가 없는 기록에만 키를 생성한다. DB나 이미지가 이미 유실됐다면 복원하지 못한다.
- `POST /api/v1/sessions`는 이전 프런트 번들과의 호환용으로만 남아 있다. 반환 토큰은
  접근 권한을 구분하지 않으며, 새 프런트는 세션 생성이나 localStorage 키를 사용하지 않는다.
- `/artifacts`는 이미지별 서명을 확인하고 DB·APK·JSON·서명 없는 요청을 거절한다.
  서명은 다음 UTC 자정까지 유효하며 삭제한 진단의 서명은 즉시 무효가 된다.
  화면을 다시 열면 새 이미지 URL을 받는다. 공개 합성 데모 파일은 `/demo/`로 제공한다.

- 이미지가 2GB 정도로 크다(Chromium 포함). 빌드가 몇 분 걸릴 수 있다.
- 시연용 진단을 미리 하나 만들어 두면 첫 화면이 빈 대시보드가 되지 않는다. 대시보드는
  가장 최근에 수정한 진단을 기본으로 보여준다.
- 잘못 만든 진단은 `DELETE /api/v1/audits/{audit_id}`로 지운다. 회차·화면·탐지와 업로드·
  캡처 이미지와 작업 기록까지 함께 정리된다. 보호 목록에 든 대표 진단은 403, 검사 진행 중인 진단은 409로 거절한다. 보호 진단의 관리용 삭제는
  [데모 진단 관리](#데모-진단-관리)의 스크립트를 쓴다.

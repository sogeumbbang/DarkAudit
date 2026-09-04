# 배포 가이드 (Render + Vercel)

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
   | `DARKAUDIT_PROVIDER` | 필수 | 실제 분석은 `openai`. `fake`면 호출 없이 배선만 확인되고 탐지는 항상 0건 |
   | `DARKAUDIT_MODEL` | 필수 | Responses API의 이미지 입력과 Structured Outputs를 지원하는 모델 |
   | `OPENAI_API_KEY` | 필수 | |
   | `DARKAUDIT_COMPUTER_MODEL` | 선택 | URL `스마트 탐색` 모드에만 필요. 없으면 그 요청은 400으로 거절된다 |
   | `FIGMA_ACCESS_TOKEN` | 선택 | Figma 임포트용. `file_content:read` 권한만 있으면 된다 |
   | `DARKAUDIT_CORS_ORIGINS` | 선택 | 커스텀 도메인을 쓸 때만. 비워도 `*.vercel.app`은 허용된다 |
   | `DARKAUDIT_FRONTEND_CONTRACT` | 선택 | 기본값 `v2`(전체 개방). 프런트가 모르는 값을 막아야 할 때만 `v1`로 내린다 |

4. **디스크를 붙인다.** 대시보드 → **Disks → Add Disk**, Mount Path를
   **`/app/data`** 로 지정한다(1GB면 충분).

   이걸 빼면 재배포·재시작할 때마다 진단 기록과 캡처 이미지가 전부 사라진다.
   SQLite(`data/darkaudit.db`)와 업로드·캡처 산출물이 모두 이 경로 아래에 있다.

5. 배포가 끝나면 `https://<서비스명>.onrender.com` URL이 생긴다. **이 URL을 적어둔다.**
6. `curl https://<서비스명>.onrender.com/health` → `{"status":"ok"}` 확인.

무료 티어는 15분 미사용 시 슬립되고 첫 요청이 콜드스타트로 30초 이상 걸린다. 프런트의
API 타임아웃이 30초라 첫 방문이 그대로 실패할 수 있으므로, 시연 전에 health로 한 번
깨워두거나 유료 플랜을 쓴다.

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

   `VITE_USE_MOCKS`를 빠뜨리면 목업 모드로 떠서 백엔드를 아예 타지 않는다. 화면은 멀쩡히
   뜨고 데이터도 그럴듯해서 시연 중에 알아채기 어렵다.

4. Deploy. 끝나면 `https://<프로젝트명>.vercel.app` URL이 생긴다.
5. **Settings → Domains**에서 프로덕션 도메인을 확인한다. 제출·공유에는 이 주소를 쓴다.
   프리뷰 URL(`...-git-...vercel.app`)은 커밋마다 바뀐다.

## 배포 후 확인

1. 프로덕션 URL 접속 → `/`가 대시보드로 리다이렉트되는지.
2. 진단 생성 화면에서 **샘플 5장 불러오기** → 분석 시작 → 결과가 나오는지.
3. 탐지 항목을 클릭했을 때 캡처 화면 위에 위험 요소 박스가 그려지는지.
4. 브라우저 개발자도구 콘솔에 CORS 오류가 없는지.

실패하면 Render 대시보드 → **Logs**에서 원인을 본다. `_fail_job()`이 기록한 메시지는
`GET /api/v1/analysis-jobs/{id}`의 `error` 필드에도 그대로 나온다.

## 로컬에서 이미지만 먼저 확인하고 싶을 때

```bash
docker build -t darkaudit-backend .
docker run -p 8000:8000 -e DARKAUDIT_PROVIDER=fake darkaudit-backend
curl http://localhost:8000/health
```

`DARKAUDIT_PROVIDER=fake`면 OpenAI 호출 없이 배선만 확인한다(탐지 결과는 항상 0건).
실제 모델 응답까지 보려면 `openai`로 바꾸고 `DARKAUDIT_MODEL`/`OPENAI_API_KEY`를 같이
넘긴다.

## 알아둘 것

- 이미지가 2GB 정도로 크다(Chromium 포함). 빌드가 몇 분 걸릴 수 있다.
- 시연용 진단을 미리 하나 만들어 두면 첫 화면이 빈 대시보드가 되지 않는다. 대시보드는
  가장 최근에 만든 진단을 기본으로 보여준다.
- 잘못 만든 진단은 `DELETE /api/v1/audits/{audit_id}`로 지운다. 회차·화면·탐지와 업로드·
  캡처 이미지 파일까지 함께 정리된다.

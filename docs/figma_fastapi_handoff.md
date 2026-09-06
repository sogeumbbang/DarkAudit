# Figma 진단 FastAPI 설계

작성일: 2026-09-03  
대상: DarkAudit 백엔드 구현자  
상태: 구현 전 설계 확정안

## 1. 목표와 범위

Figma 디자인 파일의 모바일 프레임을 PNG로 렌더링한 뒤, 이미 검증된 `BaselineAuditPipeline`에 전달한다.

이번 구현 범위는 다음과 같다.

1. 프론트가 이미 호출하는 `POST /api/v1/audits/{audit_id}/figma` 구현
2. Figma 파일 URL 검증 및 file key 추출
3. 분석 대상 프레임 탐색과 최대 5개 선택
4. Figma REST API를 통한 PNG 렌더링 및 로컬 저장
5. 기존 `AuditRun`, `Screen`, `JobDto`, `analyze_uploaded_screens()` 재사용
6. 실패 원인을 프론트 polling 응답의 `error`에 노출

범위에서 제외한다.

- 프로토타입 인터랙션 그래프의 완전한 재현
- Figma 레이어를 `Element` 테이블에 직접 저장하는 기능

Figma 연결 버튼과 사용자별 OAuth token lifecycle은 운영에 필수이므로 구현 범위에 포함한다.

운영 서비스이므로 인증은 처음부터 **사용자별 Figma OAuth 2**로 구현한다. Personal Access Token은 로컬 개발자가 자기 파일을 점검하는 임시 수단일 뿐이며 운영 인증으로 사용하지 않는다.

## 2. 현재 구조와 연결점

- 프론트 호출: `frontend/src/api/audits.ts::importFigmaAudit`
- 라우터 추가 위치: `backend/api/main.py`
- 요청/응답 스키마: `backend/api/schemas.py`
- 서비스 추가 위치: `backend/api/service.py`
- 분석 재사용 함수: `analyze_uploaded_screens(job_id, run_id, local_paths)`
- 파일 저장 루트: `data/figma/{audit_id}/run-{version}/`
- 비동기 상태 조회: `GET /api/v1/analysis-jobs/{job_id}`

별도의 분석 엔진을 만들지 않는다. Figma는 입력 수집기이며, 분석은 기존 이미지 파이프라인을 그대로 사용한다.

## 3. 외부 API

Figma 공식 REST API의 다음 두 엔드포인트만 사용한다.

- 파일/노드 조회: `GET https://api.figma.com/v1/files/{file_key}`
- 프레임 렌더링: `GET https://api.figma.com/v1/images/{file_key}?ids=...&format=png&scale=2&contents_only=true`

인증 헤더:

```http
Authorization: Bearer ${USER_FIGMA_ACCESS_TOKEN}
```

필요 scope는 `file_content:read`이다. 렌더 API가 반환하는 URL은 임시 URL이므로 즉시 서버 저장소로 다운로드한다. 렌더 결과 map의 값이 `null`일 수 있으므로 노드별 실패를 검사한다.

공식 문서:

- https://developers.figma.com/docs/rest-api/file-endpoints/
- https://developers.figma.com/docs/rest-api/authentication/
- https://developers.figma.com/docs/rest-api/rate-limits/

## 4. Figma OAuth 2 연결

### 필요한 Figma 앱 설정

Figma Developer Console에서 OAuth app을 등록하고 운영 callback URL을 등록한다.

- 최소 scope: `file_content:read`
- 연결 계정 표시가 필요하면 추가: `current_user:read`
- redirect URI 예: `https://api.darkaudit.example.com/api/v1/integrations/figma/callback`
- 브라우저 기반 authorization code flow 사용
- `state` 검증 필수
- 가능하면 PKCE도 적용

사용자는 DarkAudit의 **Figma 연결** 버튼을 눌러 Figma 동의 화면에서 권한을 승인한다. DarkAudit은 사용자의 OAuth access token으로만 해당 사용자가 접근 가능한 파일을 읽는다.

### OAuth API

```http
GET /api/v1/integrations/figma/connect
GET /api/v1/integrations/figma/callback?code=...&state=...
GET /api/v1/integrations/figma/status
DELETE /api/v1/integrations/figma
```

`connect`는 로그인된 DarkAudit 사용자에 연결된 state를 서버 저장소에 생성하고 다음 Figma URL로 302 redirect한다.

```text
https://www.figma.com/oauth
  ?client_id=...
  &redirect_uri=...
  &scope=file_content:read,current_user:read
  &state=<cryptographically-random-value>
  &response_type=code
```

callback은 code를 서버에서 token으로 교환하고 연결 레코드를 저장한 뒤 프론트의 연결 완료 화면으로 redirect한다. `client_secret`과 token은 브라우저로 전달하지 않는다.

### 연결 저장 모델

```python
class FigmaConnection(Base):
    __tablename__ = "figma_connection"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("user.id"), unique=True)
    figma_user_id: Mapped[str] = mapped_column(String(100))
    access_token_ciphertext: Mapped[str] = mapped_column(Text)
    refresh_token_ciphertext: Mapped[str] = mapped_column(Text)
    access_token_expires_at: Mapped[datetime] = mapped_column(DateTime)
    scopes: Mapped[list[str]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime)
    updated_at: Mapped[datetime] = mapped_column(DateTime)
```

현재 저장소에는 DarkAudit 사용자/세션 모델이 없으므로 OAuth 구현 전에 인증 주체를 먼저 확정해야 한다. 최소한 `current_user.id`를 FastAPI dependency로 얻을 수 있어야 하며, `Audit`에도 `owner_user_id`를 추가해 다른 사용자의 audit에 Figma 연결을 사용할 수 없게 한다.

토큰 저장 규칙:

- 애플리케이션 레벨 envelope encryption 또는 KMS 사용
- DB에는 암호문만 저장
- encryption key는 DB와 분리된 Secret Manager에 저장
- access token 만료 전에 refresh token으로 갱신
- 사용자별 최신 access token만 사용하도록 refresh 동시 실행에 lock 적용
- 연결 해제 시 토큰 폐기 및 로컬 암호문 삭제
- 토큰을 로그, Job error, API 응답에 절대 포함하지 않음

### 환경변수

`.env.example`에 추가한다.

```dotenv
FIGMA_OAUTH_CLIENT_ID=
FIGMA_OAUTH_CLIENT_SECRET=
FIGMA_OAUTH_REDIRECT_URI=https://api.darkaudit.example.com/api/v1/integrations/figma/callback
FIGMA_TOKEN_ENCRYPTION_KEY=
FIGMA_API_BASE_URL=https://api.figma.com/v1
FIGMA_HTTP_TIMEOUT_SECONDS=30
FIGMA_RENDER_SCALE=2
FIGMA_MAX_FRAMES=5
```

규칙:

- OAuth client secret과 암호화 key는 Secret Manager로 주입한다.
- `FIGMA_API_BASE_URL`은 테스트에서 mock transport를 넣기 위한 설정이다.

## 5. HTTP 계약

### 요청

```http
POST /api/v1/audits/{audit_id}/figma
Content-Type: application/json
```

```json
{
  "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/DarkAudit-Mobile-Banking-Mockup?node-id=3-2",
  "target": "mobile-web",
  "selectionMode": "all-frames",
  "flowName": null
}
```

Pydantic 모델:

```python
class ImportFigmaRequest(BaseModel):
    fileUrl: HttpUrl
    target: Literal["mobile-web", "desktop-web", "app"]
    selectionMode: Literal["prototype-flow", "all-frames"]
    flowName: str | None = Field(default=None, max_length=200)
```

검증 규칙:

- scheme은 `https`만 허용
- host allowlist: `figma.com`, `www.figma.com`
- URL path 형식: `/design/{file_key}/...`
- file key: 영숫자, `_`, `-`만 허용하고 길이 제한 적용
- `node-id=3-2`는 API용 `3:2`로 변환
- `prototype-flow`에서 `flowName`이 비어 있으면 400
- MVP에서 프로토타입 flow 해석을 아직 지원하지 않으면 422로 명확히 거부하며 임의로 all-frames로 대체하지 않는다.
- 로그인된 DarkAudit 사용자에게 활성 Figma 연결이 없으면 409 `FIGMA_NOT_CONNECTED`
- audit의 `owner_user_id`와 로그인 사용자가 다르면 403

### 성공 응답

기존 `JobDto`를 그대로 사용하며 즉시 `202 Accepted`를 반환한다.

```json
{
  "jobId": "job-...",
  "auditId": "audit-1",
  "status": "queued",
  "progress": 5,
  "runId": "run-12",
  "error": null
}
```

### 동작 순서

요청 처리 스레드에서는 다음까지만 수행한다.

1. 입력, 로그인 사용자, audit 소유권 검증
2. 사용자별 FigmaConnection 조회 및 access token refresh
3. audit 존재 확인
4. 새 `AuditRun` 생성
5. `JobDto` 생성
6. `BackgroundTasks`에 `import_and_analyze_figma(user_id=...)` 등록
7. 202 반환

Figma 네트워크 호출과 렌더 다운로드는 background task에서 수행한다.

## 6. 대상 프레임 선택 규칙

우선순위는 결정적으로 유지한다.

1. URL에 `node-id`가 있으면 해당 노드 하나만 선택한다.
2. `selectionMode=all-frames`이면 모든 Page의 직접 자식 중 `FRAME`, `COMPONENT`, `INSTANCE`, `SECTION` 후보를 수집한다. 모바일 target에서 넓은 Flow 컨테이너나 Section 안에 모바일 프레임이 여러 개 있으면 가장 바깥쪽 모바일 프레임을 각각 선택하며, 그 내부 UI 레이어는 다시 화면 후보로 수집하지 않는다.
3. 화면 후보는 `visible != false`, width/height > 0인 노드만 허용한다.
4. 모바일 target이면 세로형이며 폭 280~600px인 후보를 우선한다.
5. 캔버스 순서 `(page index, y, x)`로 정렬한다.
6. 최대 `FIGMA_MAX_FRAMES`개만 선택한다.

첫 MVP에서는 `01_Product_Select`처럼 화면 프레임 이름의 숫자 prefix를 flow 순서로 활용한다. 숫자 prefix가 없는 경우 캔버스 순서를 사용한다.

선택 결과가 0개이면 422로 실패 처리한다.

## 7. 서비스 구조

권장 파일:

```text
backend/api/
  figma_client.py       # Figma HTTP, URL 파싱, 응답 검증
  figma_import.py       # 프레임 선택, 다운로드, Screen 생성
  main.py               # FastAPI route
  service.py            # 기존 job/run/analysis orchestration
```

핵심 인터페이스:

```python
@dataclass(frozen=True)
class FigmaFrame:
    node_id: str
    name: str
    width: int
    height: int
    page_index: int
    x: float
    y: float

class FigmaClient:
    # 호출마다 해당 사용자의 OAuth access token을 주입한다.
    def get_file(self, file_key: str) -> dict: ...
    def render_frames(self, file_key: str, node_ids: list[str]) -> dict[str, str | None]: ...
    def download_render(self, url: str, destination: Path) -> None: ...

def import_and_analyze_figma(
    job_id: str,
    run_id: int,
    *,
    audit_id: str,
    request: ImportFigmaRequest,
) -> None: ...
```

`import_and_analyze_figma()` 처리:

1. `_mark_running(job_id, run_id, 10)`
2. file key/node id 파싱
3. 파일 tree 조회
4. 프레임 선택
5. 렌더 URL 요청
6. PNG 다운로드 및 Pillow로 이미지 검증
7. DB에 `Screen` 생성
8. commit
9. 기존 `analyze_uploaded_screens(job_id, run_id, paths)` 실행

주의: `analyze_uploaded_screens()`도 `_mark_running()`을 호출한다. 중복 상태 갱신을 허용하거나, 내부 분석 부분을 `analyze_run_screens()`로 추출해 두 수집기가 공유하도록 리팩터링한다. 후자를 권장한다.

## 8. 저장 규칙

```text
data/figma/{audit_id}/run-{version}/
  manifest.json
  01_01_Product_Select.png
  02_02_Confirm.png
```

`manifest.json` 예시:

```json
{
  "fileKey": "YtP0tCCij8KTBOiZXkzh9B",
  "fileVersion": "...",
  "selectionMode": "all-frames",
  "frames": [
    {
      "nodeId": "3:2",
      "name": "01_Product_Select",
      "width": 393,
      "height": 852,
      "image": "01_01_Product_Select.png"
    }
  ]
}
```

`Screen` 매핑:

- `screen_index`: 선택 순서, 1부터 시작
- `flow_step`: Figma frame name
- `image_path`: `/artifacts/figma/...png`
- `viewport_w`, `viewport_h`: Figma absoluteBoundingBox 크기
- `flow_type`: `FlowType.join`

## 9. 네트워크 및 보안

Figma API host와 렌더 다운로드 host를 구분한다.

- API 요청은 고정된 `https://api.figma.com`으로만 전송한다.
- 사용자 입력 URL을 서버가 직접 fetch하지 않는다. URL에서 file key와 node id만 추출한다.
- 렌더 URL은 Figma API 응답에서만 얻으며 반드시 HTTPS여야 한다.
- redirect 횟수 제한, connect/read timeout, 최대 응답 크기를 적용한다.
- 다운로드 최대 크기: 이미지당 10MB, 총 50MB
- PNG/JPEG Content-Type과 실제 magic bytes를 함께 검사한다.
- 파일명은 Figma node name을 직접 사용하지 않고 sanitize한다.
- 토큰/렌더 URL을 사용자에게 반환하거나 영구 로그에 남기지 않는다.

## 10. 오류 매핑

초기 요청 검증 오류는 HTTP 응답으로, background 오류는 Job의 `status=failed`, `error`로 전달한다.

| 조건 | HTTP/Job code | 사용자 메시지 |
|---|---:|---|
| 잘못된 Figma URL | 400 | 유효한 Figma design 링크가 아닙니다. |
| DarkAudit 로그인 없음 | 401 | 로그인이 필요합니다. |
| audit 소유권 없음 | 403 | 이 진단에 접근할 수 없습니다. |
| Figma 미연결 | 409 | Figma 계정을 먼저 연결해주세요. |
| `prototype-flow`인데 flowName 없음 | 400 | 프로토타입 흐름 이름이 필요합니다. |
| Figma 401/403 | failed | Figma 인증 또는 파일 접근 권한을 확인해주세요. |
| Figma 404 | failed | Figma 파일을 찾을 수 없습니다. |
| Figma 429 | failed | Figma 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요. |
| 대상 프레임 없음 | failed | 분석 가능한 프레임이 없습니다. |
| 일부 렌더 null | 계속 | 성공한 프레임만 분석하고 누락 목록 기록 |
| 모든 렌더 실패 | failed | Figma 프레임 렌더링에 실패했습니다. |
| 이미지 제한 초과 | failed | 프레임 이미지가 허용 크기를 초과했습니다. |
| AI 분석 실패 | failed | 기존 `_fail_job()` 메시지 사용 |

내부 로그에는 `job_id`, `audit_id`, file key의 앞 6자, node count, Figma status code, latency만 남긴다.

## 11. 재시도와 idempotency

- GET file/render: timeout, 429, 5xx에만 최대 3회 exponential backoff + jitter
- 400/401/403/404는 재시도하지 않는다.
- 다운로드 실패는 해당 이미지에 한해 2회 재시도한다.
- 하나의 POST 요청은 항상 새 AuditRun을 만든다.
- background task 재실행 시 같은 run directory의 manifest와 이미지가 유효하면 재사용할 수 있다.

장기적으로는 FastAPI `BackgroundTasks` 대신 Celery/RQ/Arq 등 영속 queue를 사용해야 한다. 현재 구조와 맞추는 MVP에서는 `BackgroundTasks`를 유지한다.

## 12. 테스트 계획

### 단위 테스트

1. Figma URL에서 file key/node id 추출
2. 허용되지 않은 host, http scheme, malformed key 거부
3. 파일 tree에서 top-level frame 수집 및 순서 결정
4. 모바일/데스크톱 target 필터링
5. max 5 제한
6. render map의 null 처리
7. 토큰이 오류/로그에 노출되지 않음
8. 조건별 Figma status code 매핑
9. OAuth state 불일치/만료 거부
10. access token refresh 및 동시 refresh lock
11. 사용자 A의 연결로 사용자 B의 audit/file 요청 불가
12. 로그와 API 응답에 token이 노출되지 않음

### API 테스트

`httpx.MockTransport` 또는 respx로 외부 호출을 전부 mock한다.

1. 정상 요청은 202 + JobDto
2. audit 없음은 404
3. Figma 연결 없음은 409
4. 잘못된 URL은 400
5. Figma 403은 job failed
6. 성공 시 `AuditRun`과 `Screen`이 DB에 저장됨
7. 기존 `analyze_uploaded_screens`가 렌더 파일 목록으로 호출됨

### 수동 인수 테스트

검증 기준 파일:

- Figma file key: `YtP0tCCij8KTBOiZXkzh9B`
- frame: `01_Product_Select`
- node id: `3:2`
- 예상 크기: 393×852

완료 기준:

1. POST가 202를 반환한다.
2. polling이 queued → analyzing → completed로 전환된다.
3. 화면 1개가 393×852로 저장된다.
4. 진단에서 `DA-04 PRESELECTED_OPTION`이 검출된다.
5. 진단에서 `DA-03 VISUAL_HIERARCHY_DISTORTION`이 검출된다.
6. 현재 기준 신뢰도는 각각 약 0.94, 0.91이며 모델 변동을 고려해 자동 테스트에서는 `>= 0.70`만 요구한다.
7. 대시보드에서 이미지와 bbox가 올바른 위치에 표시된다.

## 13. 구현 순서

1. DarkAudit 사용자 인증과 `Audit.owner_user_id` 확정
2. Figma OAuth app 등록 및 callback URL 설정
3. `FigmaConnection` 모델, 암호화 저장, refresh 구현
4. connect/callback/status/disconnect API 구현
5. `ImportFigmaRequest` 및 환경설정 추가
6. URL parser와 사용자 token 기반 `FigmaClient` 작성 + 단위 테스트
7. frame selector 작성 + 단위 테스트
8. import/download 서비스 작성
9. FastAPI route와 BackgroundTask 연결
10. API 통합 테스트
11. 기준 Figma 파일로 수동 인수 테스트
12. 오류 메시지를 프론트 공통 문구 대신 서버 `detail/error`로 노출

## 14. 구현 시 결정이 필요한 한 가지

`prototype-flow`는 Figma prototype transition 그래프를 읽어야 하므로 all-frames보다 구현량이 크다. MVP 권장안은 다음과 같다.

- 1차: `all-frames`와 URL의 단일 `node-id` 지원
- `prototype-flow`: 명시적 422 반환
- 2차: flow 시작 노드와 reactions를 따라 순서를 계산하는 기능 추가

지원하지 않는 모드를 조용히 all-frames로 바꾸면 사용자가 다른 화면 집합을 진단하게 되므로 금지한다.

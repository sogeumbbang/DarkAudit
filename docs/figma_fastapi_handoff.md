# Figma 가져오기 구현 안내

> 현재 구현 기준 · 2026-10-08 · 기준 커밋 `5748f51`

Figma 프레임을 PNG로 내려받고 노드 텍스트·위치·프로토타입 경로를 공통 이미지 분석 파이프라인에 전달한다. 기존 구현 전 설계의 OAuth API와 연결 저장 모델은 구현되어 있지 않다. 이 문서는 현재 서버 공용 Personal Access Token(PAT) 경로를 설명한다.

## 1. 지원 범위

- HTTPS `figma.com`·`www.figma.com`의 `/design/`·`/file/` 링크.
- 파일 전체 또는 `node-id`로 지정한 Canvas·Section·Frame 내부 화면.
- `prototype-flow`: 프로토타입 시작점·연결·분기를 따라 경로 선택.
- `all-frames`: 프레임 선택 후 캔버스 순서로 가져오기. 실제 사용 순서로 검증된 것은 아니므로 한계를 기록.
- 렌더 이미지와 노드 근거를 분석하고 같은 Audit에 새 회차로 저장.

사용자별 Figma 로그인·OAuth 연결, 실제 프로토타입 브라우저 실행, 디자인 자동 수정은 제공하지 않는다.

## 2. 코드 연결점

| 파일 | 역할 |
| --- | --- |
| [main.py](../backend/api/main.py) | 요청 검증, 새 회차·작업 생성, 백그라운드 실행 |
| [schemas.py](../backend/api/schemas.py) | `ImportFigmaRequest`·`JobDto` |
| [figma_client.py](../backend/api/figma_client.py) | URL 파싱·설정·파일 조회·렌더 다운로드 |
| [figma_frames.py](../backend/api/figma_frames.py) | 컨테이너·프레임·프로토타입 경로 선택 |
| [figma_import.py](../backend/api/figma_import.py) | `import_and_analyze_figma`·저장·노드 근거 추출 |
| [service.py](../backend/api/service.py) | 공통 `analyze_run_screens`·결과 저장·비교 |
| [audits.ts](../frontend/src/api/audits.ts) | 프런트 가져오기 API 호출 |

## 3. Figma API 사용

현재 클라이언트는 파일·노드 문서 조회에 `GET /v1/files/{file_key}`, PNG 렌더 요청에 `GET /v1/images/{file_key}`를 사용한다. 렌더 요청에는 `ids`, `format=png`, `scale`, `contents_only=true`를 전달한다.

서버의 `FIGMA_ACCESS_TOKEN`을 `X-Figma-Token` 헤더로 전송한다. 렌더 응답의 HTTPS 이미지 URL은 곧바로 다운로드하며 노드별 `null` 응답은 누락으로 기록한다.

## 4. 인증과 환경변수

| 변수 | 코드 기본값 | 용도 |
| --- | --- | --- |
| `FIGMA_ACCESS_TOKEN` | 없음 | 서버 공용 PAT. 대상 파일 접근 권한과 `file_content:read` 필요 |
| `FIGMA_API_BASE_URL` | `https://api.figma.com/v1` | API 주소 |
| `FIGMA_HTTP_TIMEOUT_SECONDS` | `30` | HTTP 요청 제한 시간 |
| `FIGMA_RENDER_SCALE` | `2` | PNG 렌더 배율 |
| `FIGMA_MAX_FRAMES` | `6` | 프레임 수집 예산 |
| `DARKAUDIT_DEMO_FIGMA_URL` | 설정값에 따름 | 데모 카탈로그의 Figma 파일 |

루트 `.env.example`에는 `FIGMA_MAX_FRAMES=20`이 명시되어 있다. 복사해서 사용하면 코드 기본값 6 대신 20이 적용된다. 모델 요청의 상한은 6장이므로 더 긴 경로는 배치로 나눠 분석한다.

사용자별 OAuth를 추가하려면 사용자 인증·권한 모델, state 검증, 토큰 암호화·갱신·폐기와 API 연결을 별도로 구현해야 한다. 현재 `/api/v1/integrations/figma/*` 엔드포인트는 없다.

## 5. HTTP 계약

```http
POST /api/v1/audits/{audit_id}/figma
Content-Type: application/json
```

```json
{
  "fileUrl": "https://www.figma.com/design/FILE_KEY/Example?node-id=3-2",
  "target": "mobile-web",
  "selectionMode": "prototype-flow",
  "flowName": "문제 포함 원본"
}
```

`target`은 `mobile-web`, `desktop-web`, `app` 중 하나다. `selectionMode`는 필수이며 `prototype-flow` 또는 `all-frames`다. `flowName`은 선택 문자열(최대 200자)이다. 데모는 선택 필드 `demoVariant`로 `risky`·`partial`·`revised`를 전달할 수 있다.

응답은 **202 `JobDto`**이며 접수 성공을 의미한다. `GET /api/v1/analysis-jobs/{job_id}`로 `queued → analyzing → completed/failed`, 진행률과 오류를 조회한다. 수집과 모델 호출 실패는 작업 조회에 표시되며 접수 응답의 HTTP 상태가 나중에 바뀌지는 않는다.

## 6. 프레임과 경로 선택

`prototype-flow`는 파일의 시작점과 연결을 따라 경로를 만들고 경로 사이에 공유된 프레임을 한 번만 저장한다. 선택한 경로를 화면 순번 목록으로 분석 요약에 남긴다. 경로 탐색은 코드의 `max_paths=8` 한도를 별도로 사용한다. 연결·분기 누락이나 수집 상한은 경고로 보존한다.

`all-frames`는 대상 컨테이너 안에서 프레임을 고른다. 모바일 대상에서는 세로형 모바일 프레임을 우선하며 여러 화면을 감싼 컨테이너를 확장한다. 캔버스 순서에는 `figma_canvas_order_not_verified_journey`, 잘린 프레임에는 `figma_omitted_frames:N`을 기록한다.

가격·이율의 공개 순서를 비교하려면 실제 사용 경로가 필요하다. 캔버스 배치만으로 완료된 가입 흐름이라고 간주하지 않는다.

## 7. `import_and_analyze_figma` 처리 순서

1. 작업을 실행 상태로 바꾸고 설정·토큰을 읽는다.
2. URL에서 file key와 node ID를 얻고 파일 문서를 조회한다.
3. 프레임과 경로를 선택해 렌더를 요청한다.
4. PNG를 검증·저장하고 Screen에 단계명·뷰포트·노드 근거를 기록한다.
5. `manifest.json`과 경로·누락 경고를 저장한다.
6. 공통 `analyze_run_screens`로 분석·근거 보정·결과 저장·회차 비교를 수행한다.
7. 예외는 `_fail_job`으로 작업과 회차에 남긴다.

가져온 텍스트 노드는 `Screen.analysis_context.evidence`에 정규화 bbox와 함께 기록한다. DOM 규칙 후보 생성 경로와 같지 않으며 이미지 분석의 근거로 사용한다.

## 8. 파일 저장과 제한

저장 경로는 `data/figma/{audit_id}/run-{version}/`이다. 프레임 PNG와 `manifest.json`에 파일·선택 방식·노드 정보·누락 목록을 남긴다. 프레임 이름은 파일명에 안전한 문자로 정리한다.

이미지 한 장은 **10 MiB**, 내려받은 이미지 합계는 **50 MiB** 이하다. Pillow로 이미지 내용을 검증한다. 렌더되지 않은 일부 프레임은 경고를 남기고 나머지로 진행하지만 가져온 이미지가 하나도 없으면 실패한다.

프런트에는 서명된 이미지 URL만 제공하며 `manifest.json`은 `/artifacts`로 공개하지 않는다. 관련 파일은 진단 삭제 시 함께 정리된다.

## 9. 재시도와 검증

파일·렌더 API의 timeout 및 429·500·502·503·504 응답은 최대 3회 시도한다. 이미지 다운로드는 최대 2회다. 모델 응답 검증 재시도는 [분석 파이프라인](architecture.md#3-모델-요청과-출력-검증)의 별도 처리다.

외부 Figma 호출 없이 관련 계약을 확인한다.

```bash
python -m unittest backend.tests.test_figma_import backend.tests.test_figma_paths -v
```

## 10. 오류 확인

| 시점 | 오류 | 확인할 내용 |
| --- | --- | --- |
| 요청 접수 | 400 | HTTPS Figma design/file URL과 node-id 형식 |
| 요청 접수 | 404 | Audit 존재 여부 |
| 요청 접수 | 409 | 동일 진단의 진행 중 작업 |
| 요청 검증 | 422 | target·selectionMode·flowName 등 요청 형식 |
| 작업 실행 | 토큰 미설정·401/403 메시지 | 서버 PAT의 만료와 파일 접근 권한 |
| 작업 실행 | 프레임 없음·렌더 실패 | 컨테이너/Flow 이름·프레임 가시성·렌더 응답 |
| 작업 실행 | 용량·이미지 검증 실패 | 프레임 크기·렌더 배율·수집 수 |
| 작업 실행 | 모델 검증 실패 | 작업 error와 서버 로그, 분석 모델 설정 |

토큰을 프런트 환경변수나 소스에 넣지 않는다. 운영 설정과 영속 디스크는 [배포 가이드](deploy.md), 데모 버전 선택은 [데모 안내](../demo/README.md)를 참고한다.

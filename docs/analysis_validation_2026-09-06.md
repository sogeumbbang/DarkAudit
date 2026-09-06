# 분석 입력 4종 기능 검증 및 개선 제안

검증일: 2026-09-06. 대상: 현재 로컬 체크아웃의 URL, Figma, APK, 스크린샷 분석 경로. 제품 코드는 수정하지 않았다.

## 결론

네 입력 모두 분석 함수까지 연결되어 있지만, **모두 정상적으로 다크패턴을 탐지한다고 판정할 수 없다.** URL과 Figma에는 재현 가능한 수집·후보 누락이 있고, APK 탐색은 동일 버튼을 사용하는 연속 화면에서 조기 종료할 수 있다. 공통 이미지 분석기는 실제 모델 호출에 성공했으나 일부 규칙 누락·근거 연결 오류가 관찰됐다. 별도 좌표 검증 호출은 실제 API에서 400 오류가 발생했다.

| 입력 | 연결 구조 | 이번 판정 |
| --- | --- | --- |
| URL | Playwright → 화면 선택 → DOM Rule Engine → LLM 후보 검증 → DB | DOM 추출 및 이미지 분할 과정에 확정 결함. 임의의 운영 웹사이트 전체 흐름은 미검증 |
| Figma | REST 프레임 선택·PNG 렌더 → 공통 이미지 분석 → DB | REST 전환 필드 불일치 및 node-id 우선 처리로 흐름 누락 재현. 실제 Figma 인증·파일 다운로드는 미검증 |
| APK | BrowserStack 설치·실행 → UI XML 기반 탭·캡처 → 공통 이미지 분석 → DB | 반복 버튼 오제외 재현. 실제 APK 업로드·기기 실행은 미검증 |
| 스크린샷 | 업로드 → 공통 이미지 분석 → DB | 실제 샘플 5장 모델 호출 성공. 탐지·분류·대립 선택지 근거 품질은 개선 필요 |

현재 분석 계약은 DA-03·04·07·12·15의 **5개 MVP 규칙**이다. YAML에 15개 유형이 있어도 모두 실행되는 것은 아니다. 정지 이미지로 실제 클릭 이력, 최초 기본 선택 여부, 동적 효과를 완전히 증명할 수도 없다.

## 실행한 검증과 제한

- AI: `python -m unittest discover -s ai/tests -v` — 68개 통과.
- Backend 전체 discovery: 47개 테스트 실행, Figma 통합 테스트 클래스 초기화 오류 1건. API 테스트가 공유 SQLite 임시 디렉터리를 삭제해 후속 클래스가 `attempt to write a readonly database`로 실패한다.
- Backend 파일별 별도 프로세스 실행: unittest 56개 통과. `test_rule_engine_bbox.py`의 함수형 테스트 3개는 unittest가 수집하지 않아 직접 호출했고 모두 통과했다. 따라서 전체 discovery가 정상이라는 뜻은 아니다.
- Frontend: `npm run test` — 5개 파일/12개 테스트 통과. `npm run build`, `npm run lint` 통과. 실제 브라우저 E2E 전체는 실행하지 않았다. 입력 4종 프런트 테스트는 MSW 기반이다.
- 실제 Chrome에서 테스트 HTML에 저장소 DOM 추출 JavaScript를 실행하여 ARIA 체크 상태 및 비용 안내 텍스트 누락을 재현했다.
- 현재 설정된 `gpt-5.4-mini`에 저장소 `frontend/public/sample-audit/`의 5장을 순서대로 전달했다. 공통 `BaselineAuditPipeline(..., allow_visual_fallback=True)` 호출 1회 성공, 약 8.65초, 스키마 재시도 0회. 이것은 배포 서버를 통한 업로드 E2E나 통계적인 정확도 평가가 아니다.
- 로컬에는 OpenAI 설정이 있으나 Figma 토큰과 BrowserStack 인증 정보는 없었다. 실제 대상 Figma URL/APK도 제공되지 않았다. 배포 환경의 설정 상태는 조사하지 않았다.
- 검증 환경은 임시 Python 3.14.2 가상환경이며 배포 Docker의 Python 3.12와 다르다. 프런트 설치 시 Node 24.13.0이 jsdom의 요구 버전보다 낮다는 경고가 있었으나 위 검증은 통과했다.

## 1. 공통 좌표 검증 API가 400으로 실패한다 — 최우선

위치: `ai/providers/openai_provider.py:162`, `ai/vision/candidate_grounding.py:477`.

`bbox_candidate_selection`의 `rule_id`는 `const`만, `selected_candidate_id`는 `enum`만 지정하고 `type`을 누락한다. 메인 분석과 달리 스키마 정규화도 거치지 않는다. 실제 추가 호출에서 다음 오류를 확인했다.

```text
Invalid schema for response_format 'bbox_candidate_selection':
In context=('properties', 'rule_id'), schema must have a 'type' key.
```

호출부는 예외를 잡아 `decision=None`으로 처리한다. 이번 실제 분석에서도 모델의 후보 선택 없이 CV 좌표가 적용됐고 `grounding_usage=null`, `source=cv`였다. 탐지 전체가 중단되는 문제는 아니지만, 모델이 좌표 후보를 검증한다는 설계가 작동하지 않는다.

**제안:** 두 문자열 필드 모두 `type: string`을 명시하고 API 스키마 생성 경로를 통합한다. 현재 정규화기는 `const`만 보완하므로 단순히 정규화 함수를 호출하는 것만으로 enum 필드까지 해결되지는 않는다. 실패 원인과 대체 처리 여부를 telemetry에 남긴다. DA-03 후보 선택 프롬프트의 고정된 “selected-state control” 문구도 CTA에 맞게 바꾼다.

**완료 기준:** 실제 후보 선택 호출이 정상 응답하고, 후보 거절 시 원래 bbox를 유지하며, 의도적으로 만든 400 오류가 결과의 품질 정보에 표시된다.

## 2. URL의 DOM 후보가 사라지거나 생성되지 않는다 — 최우선

위치: `ai/pipeline/web_audit.py:148`, `ai/browser/playwright_driver.py:61`, `backend/app/rule_engine/checks.py:150`, `backend/api/service.py:235`.

재현된 문제:

1. Full-page 이미지를 분할하면서 새 `CaptureArtifact`에 `dom_elements`를 전달하지 않는다. DOM 요소가 있는 원본 1장을 분할하면 4개 crop 모두 DOM 요소가 0개가 됐다.
2. DOM 추출 자체가 viewport 밖 요소를 제외하고 viewport 기준 좌표를 사용한다. full-page 캡처를 했다고 페이지 하단 DOM까지 확보되는 것은 아니다.
3. `role=checkbox aria-checked=true`를 checkbox로 분류하지만, 상태는 네이티브 `.checked`만 읽는다. 실제 Chrome 재현에서 `checked=null`, DA-04 후보 0개였다. `role=switch`도 지원하지 않는다.
4. 금액·이율이 들어간 텍스트를 `price`로 분류하지만 DA-07 비대칭 검사는 `text`만 대상으로 한다. 9px/저대비의 해지 수수료 문구도 실제 Chrome 재현에서 DA-07 후보 0개였다. `accordion`을 생성하지 않는 추출기와 이를 요구하는 검사 사이에도 계약 불일치가 있다.

URL 분석은 DA-04·07·15를 새로운 semantic finding으로 만들 수 없으므로, 이런 후보 누락을 LLM이 화면만 보고 복구할 수 없다. 두 기기 프로필과 분할 화면을 전부 합쳐 최대 5장으로 균등 선택하는 과정에서도 일부 상태가 빠진다.

**제안:** 스크롤 위치와 문서 좌표를 포함해 DOM을 수집하고 crop별 교차 요소를 clip·재정규화한다. HTML/ARIA 체크 상태, switch, details/summary 등의 역할을 정규화한다. 텍스트와 가격 속성을 배타적으로 분리하지 말고 DA-07 검사를 가격을 포함한 의미 있는 텍스트에도 적용한다. DOM 확보 실패 시 해당 규칙을 '검사 불가'로 표시하거나 근거 수준이 구분되는 시각 검증 경로를 사용한다.

DA-15 비교는 기기·상품·실제 탐색 경로별로 나누어야 한다. 현재 `_build_rule_flow()`는 프로필 정보를 버리므로 서로 다른 기기의 가격이나 같은 페이지의 다른 구간이 후보 비교 대상이 될 수 있다. 요소 ID도 화면 ID와 함께 저장·조회해야 화면 간 동일 DOM ID의 근거가 섞이지 않는다.

**완료 기준:** 페이지 하단 사전선택, ARIA 컨트롤, 금액이 포함된 작은 고지문을 각각 탐지한다. crop bbox가 원본 화면 위치와 일치하고, 다른 기기·다른 상품의 가격을 비교하지 않는다.

## 3. Figma 프로토타입 흐름을 실제 REST 계약대로 읽지 않는다 — 최우선

위치: `backend/api/figma_frames.py:118`, `backend/api/figma_import.py:52`.

코드는 `reactions[].action.destinationId`를 읽는다. Figma REST는 노드의 `interactions` 및 그 안의 `actions[]`를 정의한다. 이 형식으로 만든 3단계 입력의 실제 선택 결과는 첫 프레임 1개뿐이었다. 기존 테스트 fixture는 코드와 동일한 `reactions/action` 형식이어서 문제를 잡지 못한다.

또한 URL에 `node-id`가 있으면 `selectionMode=prototype-flow`보다 먼저 처리하여 프레임 하나를 반환하거나 컨테이너를 좌표순으로 선택한다. UI에서 흐름 분석을 선택해도 흐름 순서를 따르지 않을 수 있다. 분기들을 BFS로 하나의 목록에 합치는 방식도 하나의 실제 사용자 경로를 보장하지 않는다.

**제안:** `interactions[].actions[]`를 우선 지원하고 조건부 actions와 필요한 레거시 필드를 별도로 정규화한다. prototype-flow 모드에서 node-id는 시작점 또는 범위로 사용하고 전환 그래프를 탐색한다. 분기는 별도 경로로 분석한다. 부분 렌더 실패·5장 제한·생략된 프레임을 UI에 알려 결과의 범위를 명시한다.

**완료 기준:** 공식 REST 형식 fixture에서 3단계가 정확한 순서로 선택되고, 동일 node-id 링크에서도 prototype-flow 옵션이 유지된다. 이후 실제 파일로 PNG 다운로드부터 finding 저장까지 확인한다.

근거: [Figma REST node types](https://developers.figma.com/docs/rest-api/file-node-types/)의 `interactions`, [property types](https://developers.figma.com/docs/rest-api/file-property-types/)의 `Interaction.actions`, [REST changelog](https://developers.figma.com/docs/rest-api/changelog/)의 2024-09-12 항목.

## 4. APK가 필요한 후속 화면에 도달하지 못할 수 있다 — 높은 우선순위

위치: `backend/api/android_runner.py:76`, `backend/api/android_runner.py:182`.

탭 시도 이력을 화면과 무관하게 `resource-id|label|bounds`로 저장한다. 이전 화면과 같은 ID·문구·좌표의 ‘다음’ 버튼은 새 화면에서도 제외된다. 두 번째 화면에서 후보가 0개가 되는 것을 재현했다. `goal`은 BrowserStack 세션 이름에만 반영되며 탐색 결정을 유도하지 않는다. 화면 수 설정은 실제로 반복 횟수 상한으로도 작동하고, 고정 1.5초 대기 외 로딩 안정화·스크롤·뒤로가기 분기 탐색이 없다.

**제안:** `(화면 상태 fingerprint, 동작 signature)`로 시도 이력을 관리하고 동일 상태의 루프와 다른 상태의 정상 전진을 구분한다. 화면 안정화 대기와 별도의 행동 예산·고유 화면 예산을 둔다. XML의 checked/bounds/text도 함께 저장해 시각 근거를 보완하고, 탐색 목표를 실제 정책에 반영한다. 로그인·결제 같은 차단 지점은 검토 범위 제한으로 기록한다.

**완료 기준:** 동일 ‘다음’ 버튼을 쓰는 3단계 테스트 앱에서 3장을 수집하고, 변화 없는 화면은 무한 반복하지 않는다. BrowserStack 인증과 테스트 APK를 갖춘 환경에서 전체 경로를 확인한다.

## 5. 공통 이미지 분석의 규칙별 품질을 검증해야 한다

실제 모델 호출 결과는 DA-04, DA-03, DA-07 각각 1건이었다.

| 관찰 | 평가 |
| --- | --- |
| 선택된 유료 옵션과 월 3,000원 추가 비용 | DA-04 탐지 및 체크박스 위치 보정 확인 |
| ‘동의하고 혜택 지키기’ CTA | DA-03 탐지. 그러나 관련 요소를 실제 거절 링크가 아닌 혜택 상실 경고문으로 반환 |
| 9,900원 → 14,400원 및 후반 추가 항목 | DA-15가 나오지 않고 최종 금액 카드를 DA-07로 분류. 규칙 혼동·누락 의심 |
| ‘지금 동의하지 않으면 … 혜택이 모두 사라져요’, ‘혜택을 포기하고 가입하기’ | DA-12 미탐지. 시각 검토상 명확한 평가 후보 |
| 마지막 화면의 작은 청약철회·해지 안내 | DA-07 평가 후보이나 해당 화면의 finding 없음 |

이 샘플은 별도 확정 gold label이 없고 호출은 1회다. 위 결과를 전체 정확도·재현율 수치로 해석하지 않는다. DA-15는 초기 고지·사용자 선택에 따른 정당한 추가 비용인지도 검수해야 한다. 다만 반환된 DA-07의 설명은 정보의 작은 글씨/저대비보다 후반 비용 공개에 초점을 맞추고 있어 분류 검증이 필요하다.

기본 프롬프트는 DA-07 semantic 생성을 금지하지만 이미지 모드에서 뒤에 붙이는 문구는 허용한다. 명시적인 모드별 프롬프트 분리가 더 명확하다. 현재 confidence 0.70 필터와 JSON 검증만으로 누락이나 잘못된 대립 선택지를 검출할 수 없다.

**제안:** 규칙마다 `detected / not_detected / insufficient_evidence / not_supported`와 근거를 작성하도록 하고, 가격 흐름은 초기·최종 금액·단위·상품·시점·선택 변경을 구조적으로 추출해 별도 검증한다. DA-03은 수락/거절 역할을 모두 검증한다. 캡처 PNG 외 Figma 텍스트·노드 좌표, Android UI XML, OCR 등 입력별 근거를 공통 증거 모델에 연결한다.

CLI도 정합성이 필요하다. `ai/cli.py:100`의 이미지 분석은 visual fallback을 켜지 않고, `URLAuditPipeline.run()`은 DOM 후보를 넘기지 않는다. 두 CLI 경로 모두 DA-04·07·15를 탐지할 경로가 빠져 있으므로 API와 분석 오케스트레이션을 공유해야 한다.

## 권장 실행 순서와 완료 기준

1. **확정 결함 수정:** 좌표 API 스키마, Figma REST·node-id 처리, URL DOM·crop 보존, APK 화면별 행동 이력. 위 재현 사례를 회귀 테스트로 추가한다.
2. **결과의 검사 범위 표시:** 모의 provider, 지원 규칙, 미수집 화면, 분기, 차단 지점, OCR·좌표 검증 실패를 구분한다. `completed`/finding 0건이 충분한 근거를 갖춘 정상 결과와 구분되게 한다. 로컬 설정은 openai지만 기본 설정은 fake이며, fake는 이미지 경로에서 항상 semantic finding 0건이고 URL에서는 후보를 모두 KEEP한다.
3. **테스트 실행 체계 정리:** DB·환경변수·service 전역 경로를 테스트별로 격리한다. 함수형 테스트까지 수집하는 단일 실행기를 정하고 실제 외부 API 형식을 fixture로 사용한다. Docker와 같은 Python 버전, 지원되는 Node 버전에서 CI를 돌린다.
4. **입력별 품질 평가:** 기존 clean/risky 22개 flow 라벨을 검수하고 대응 이미지를 준비한다. 같은 시나리오를 URL·Figma·APK·스크린샷으로 제공하여 수집 도달률과 탐지 재현율을 별도로 측정한다. 모델 버전·프롬프트·입력·원응답을 고정/기록하고 반복 평가한다.
5. **출시 판정:** 위 확정 재현 사례가 모두 통과하고 네 입력의 실제 수집→탐지→DB→UI 검증이 완료되어야 한다. 규칙별 precision/recall, clean 오탐률, bbox IoU, 경로 도달률, 비용·지연의 목표치는 검수된 기준셋에 대해 정한다. 현재 근거만으로 특정 수치를 달성했다고 주장할 수 없다.

## 보관한 실행 근거

- [로직 재현 결과](evidence/analysis-validation-2026-09-06/darkaudit-reproduction.json)
- [실제 Chrome DOM 추출 결과](evidence/analysis-validation-2026-09-06/darkaudit-browser-reproduction.json)
- [실제 샘플 5장 모델 결과와 telemetry](evidence/analysis-validation-2026-09-06/darkaudit-live-output.json)
- [좌표 검증 API의 실제 400 오류](evidence/analysis-validation-2026-09-06/darkaudit-grounding-error.json)

전체 페이지 이미지와 viewport 이미지의 차이는 [Playwright 공식 스크린샷 문서](https://playwright.dev/python/docs/screenshots)를 참고했다. 외부 명세와 코드 비교는 원인 조사에 사용했으며, 인증이 없는 Figma·BrowserStack의 실연동 성공을 대신 증명하지 않는다.

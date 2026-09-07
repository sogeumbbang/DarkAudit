# DarkAudit 데모 v2

서로 다른 네 개의 가상 금융 서비스다. 각 흐름은 **6개의 연속 화면**으로 구성하며, 실제 개인정보 입력·계약·결제는 없다. 화면의 문구와 상태 자체가 분석 입력이며 정답이나 탐지 결과를 API에 주입하지 않는다.

[전체 미리보기](index.html)

| 입력 | 서비스 | 6단계 흐름 | 산출물 |
| --- | --- | --- | --- |
| URL | roam · 로밍 패스 | 환전 멤버십 → 여행 옵션 → 혜택 알림 → 혜택 포기 확인 → 알림 재권유 → 최종 이용료 | `frontend/public/dark-pattern-demo/` |
| Figma | lit · 릿 크레딧 | 무료 체험 → 자동 갱신 설정 → 정보 제공 → 해지 만류 → 해지 절차 → 갱신 금액 | [온라인 Figma](https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/DarkAudit-Mobile-Banking-Mockup?node-id=14-2) · `demo/figma/` 생성 원본 |
| APK | moa · 모아 소액투자 | 멤버십 → 투자 설정 → 상품 알림 → 혜택 포기 → 위험 확인 → 최종 이용료 | `demo/assets/darkaudit-demo.apk` |
| 스크린샷 | moru · 모루 펫케어 | 보험 안내 → 특약 선택 → 정보 동의 → 특약 재권유 → 면책 조건 → 최종 보험료 | `frontend/public/sample-audit/`의 새 6장 |

기존 Figma 파일의 새 페이지 **Lit Credit · 6-screen demo**에 수정 가능한 6개 프레임을 생성했다. 데모 버튼은 **릿 크레딧 · 6단계** 프로토타입을 이름으로 선택하므로 기존 `01_Product_Select` 한 장은 포함하지 않는다. `previews/figma-*.png`는 실제 Figma 출력이고, `credit-*.png`는 웹 콘텐츠 원본 미리보기다. 다른 Figma 파일 URL을 환경 변수로 지정하면 전체 프레임 모드를 사용한다.

## 의도한 패턴

| 입력 | 포함한 사례 | 가격 비교 |
| --- | --- | --- |
| URL | DA-05 제한 조건과 어긋나는 100% 우대 강조, DA-07 작은 조건, DA-04 기본 체크, DA-03 수신/거절 위계 차이, DA-12 죄책감, DA-11 거절 후 재권유, DA-15 필수 비용 후공개 | 기본 4,900원 → 필수 비용 포함 6,400원; 선택 알림 포함 8,300원 |
| Figma | DA-05 점수 상승 기대 강조, DA-07 유료 전환·해지 조건 축소, DA-04 자동 갱신 기본 선택, DA-03 정보 제공 유도, DA-12 해지 만류, 해지 절차 방해, DA-15 관리비 후공개 | 체험 0원 / 고지 갱신료 7,900원 → 최종 갱신료 9,900원 |
| APK | DA-07 원금 손실 고지 축소, DA-04 자동 재투자·광고 동의, DA-03 버튼 위계, DA-12 기회 상실 압박, DA-02 이중 부정 질문, DA-15 필수 관리비 후공개 | 동일 멤버십 6,900원 → 8,400원; 유료 옵션 없음 |
| 스크린샷 | DA-05 일부 조건의 90% 보장 강조, DA-07 면책·기존 질환 제외 축소, DA-04 특약 기본 선택, DA-03 정보 제공 유도, DA-12 반려동물에 대한 죄책감, DA-15 관리비 후공개 | 기본 12,900원 → 필수 비용 포함 14,000원; 선택 특약 포함 19,000원 |

DA-15 비교에서는 **선택 옵션 비용과 필수 비용을 분리**한다. 선택 해제 시 웹 최종 금액도 바뀐다. `rules` 메타데이터는 제작 명세이며 분석 결과에 주입하지 않는다. 현재 기본 분석 파이프라인의 핵심 지원 규칙은 DA-03/04/07/12/15다. 다른 사례와 해지 방해는 추가 정성 검토용이며 실제 검출을 보장하지 않는다.

## 실행 및 데모 버튼

URL 데모 버튼은 `/demo/web/index.html?step=1`을 **스마트 탐색**으로 연다. 모바일 한 가지 프로필로 진행한다. 탐색 목표는 거절 버튼이 있으면 거절하고 다음 화면으로 계속 이동해 6단계 최종 비용을 확인하는 것이다. Computer Use 설정이 필요하다. 실제 분석용 URL은 공개 배포된 API 주소를 사용한다. 사설 네트워크 차단을 우회하지 않는다.

로컬 디자인 미리보기:

```bash
python3 -m http.server 18765 --bind 127.0.0.1 --directory frontend/public/dark-pattern-demo
```

- URL: `http://127.0.0.1:18765/index.html`
- 보험 원본: `http://127.0.0.1:18765/index.html?scenario=pet`
- 신용관리 원본: `http://127.0.0.1:18765/index.html?scenario=credit`
- `&step=1`부터 `&step=6`으로 개별 화면을 열 수 있다.

스크린샷 버튼은 아래 순서의 786×1704 PNG를 불러온다. 원본 레이아웃은 393×852 CSS px이며 2배 크기로 렌더링했다.

1. `01-product-intro.png` — 보장 소개
2. `02-preselected-addon.png` — 특약 선택
3. `03-consent-pressure.png` — 개인정보 동의
4. `04-emotional-pressure.png` — 특약 재권유
5. `05-hidden-conditions.png` — 면책 조건
6. `06-final-price.png` — 최종 보험료

폴더의 이전 `04-delayed-price.png`, `05-buried-cancellation.png`는 기존 참조 호환용이며 새 데모에서 사용하지 않는다.

6개 화면이 모두 수집되도록 기존 배포 환경도 변경한다. 설정 변경 뒤 백엔드를 재시작하고 **새 진단**을 실행한다.

```dotenv
FIGMA_MAX_FRAMES=6
ANDROID_MAX_SCREENS=6
ANDROID_MAX_ACTIONS=20
VITE_USE_MOCKS=false
```

이미지 업로드 상한과 Android 수집 상한은 6개다. 모델의 한 번 요청당 5장 계약은 유지한다. 기존 분할 분석으로 1–5번과 1·5·6번을 분석해 첫·마지막 가격 근거와 인접 화면을 보존한다. 긴 흐름 비교 제한 안내가 표시될 수 있다.

## APK

Android 6.0(API 23) 이상, 로그인·권한·네트워크 없는 네이티브 앱이다. 기본 체크를 직접 해제할 수 있으며 시스템 뒤로가기로 이전 화면을 볼 수 있다. 마지막 화면에는 거래 버튼이 없다.

```bash
ANDROID_SDK_ROOT=/path/to/android-sdk bash demo/android/build.sh
adb install -r demo/android/build/darkaudit-demo.apk
adb shell am start -n com.darkaudit.demo/.MainActivity
```

JDK 11+, Android SDK platform 34와 build-tools 34.0.0이 필요하다. 재빌드 후 `demo/assets/darkaudit-demo.apk`와 `frontend/public/dark-pattern-demo/darkaudit-demo.apk`를 갱신한다. 빌드 폴더의 디버그 서명 키는 커밋하지 않는다.

## Figma 생성 원본

`demo/figma/manifest.json`을 Figma 데스크톱의 개발 플러그인으로 가져와 **빈 Design 파일**에서 실행할 수 있다. Noto Sans KR(Regular/Bold) 또는 지원 한글 폰트가 필요하다. 393×852 프레임 6개, 네이티브 텍스트·체크 표시, 재사용 버튼 컴포넌트, 색상 변수, 화면 전환과 시작점을 생성한다. 기존 페이지를 삭제하지 않는다.

```bash
node demo/figma/build.mjs
```

`scenarios.js`의 신용관리 내용과 `source.js`에서 `code.js` 및 `flow.json`을 재생성한다. 동일 생성 원본의 화면별 실행으로 온라인 Figma 파일을 만들었으며, 독립 플러그인 전체 실행은 별도로 검증하지 않았다. `online/state.json`에 실제 노드 ID, `online/graph.json`에 전환 연결과 레이아웃 검사 결과를 보관한다. 프로토타입을 수동 분석할 때는 Flow 이름 `릿 크레딧 · 6단계`를 사용한다. 서버의 `FIGMA_ACCESS_TOKEN`에도 해당 파일의 읽기 권한이 필요하다.

## 검증과 재생성

```bash
python demo/render_previews.py
python demo/verify_android.py --adb /path/to/adb --device emulator-5554
```

첫 명령은 Playwright, Chrome, Pillow가 필요하며 외부 네트워크를 사용하지 않는다. 두 번째는 설치·실행 가능한 로컬 에뮬레이터가 필요하다.

- 웹 원본 18개: 393×852에서 가로·세로 넘침 없음, 360×800에서 가로 넘침 없음 및 이동 버튼 위치 확인.
- URL/보험: 유료 옵션 선택 해제 후 최종 금액 반영 확인.
- APK: 빌드·서명, Android 11 에뮬레이터 설치, 실제 `_tap_candidates`로 6단계 끝까지 이동 확인.
- 6장 업로드: 모든 화면 분석, 첫·마지막 가격 근거 동시 포함, 모델 요청당 5장 상한 확인.
- Figma: 실제 6개 프레임 렌더링 확인, 한글 텍스트 84개 편집 가능, 프레임 밖 텍스트 없음. 실제 전환 그래프를 분석기에 입력해 이름으로 선택한 경로가 6개이고 기존 화면이 제외됨을 확인.
- 실제 AI 검출률, BrowserStack 원격 실행, 배포 서버의 Figma 토큰 권한 검증은 포함하지 않는다.

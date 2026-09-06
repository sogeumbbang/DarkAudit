# DarkAudit 데모 입력

실제 금융상품이 아닌 **모아 투자관리**라는 가상 서비스다. 개인정보 수집, 네트워크 통신(APK), 실제 계약·결제는 없다. 실제 탐지기의 입력을 제공하며 탐지 결과를 조작하거나 주입하지 않는다.

## 웹 데모

정적 파일: `frontend/public/dark-pattern-demo/`. 프론트엔드 배포 후 주소는 `https://<frontend-domain>/dark-pattern-demo/index.html`다. 루트에서 아래 명령으로 로컬 미리보기를 실행한다.

```bash
python3 -m http.server 18765 --bind 127.0.0.1 --directory frontend/public/dark-pattern-demo
```

DarkAudit URL 분석은 사설 주소를 차단하므로 실제 URL 입력에는 공개 배포 주소를 사용한다. 임시 공개 주소가 필요하면 별도 터미널에서 `cloudflared tunnel --url http://127.0.0.1:18765 --no-autoupdate`를 실행한다. **정적 데모 폴더만 공개한다.** 임시 주소는 출력 로그에서 확인하며 서버·터널 종료 시 접근할 수 없다.

- `?step=2`: 미리 선택된 동의 화면부터 빠른 캡처.
- `?step=3`: 불균형한 선택 버튼 화면부터 빠른 캡처.
- `?step=4`: 감정적 압박 화면부터 빠른 캡처.
- `?variant=clean&step=2`: 동일 화면의 개선 버전.
- 전체 흐름: 첫 화면에서 **스마트 탐색**, 목표 `다음 버튼으로 5단계 최종 이용료까지 확인하세요. 실제 거래는 하지 마세요.`

빠른 캡처는 현재 페이지를 검사하므로 DA-15의 앞뒤 가격 비교에는 전체 흐름 캡처가 필요하다.

## Android APK

산출물: `demo/android/build/darkaudit-demo.apk`. Android 6.0(API 23) 이상에서 실행하는 오프라인 네이티브 앱이다. 기본 실행은 다크패턴 버전이며 앱 시작 시 로그인이나 권한 요청이 없다. 체크박스와 버튼은 Android 접근성 트리에서 읽을 수 있다.

DarkAudit의 **Android 앱** 탭에서 APK를 업로드한다. 백엔드에 BrowserStack 인증값을 설정하고 **5개 화면을 모두 수집**한다.

```dotenv
BROWSERSTACK_USERNAME=<your-username>
BROWSERSTACK_ACCESS_KEY=<your-access-key>
ANDROID_MAX_SCREENS=5
ANDROID_MAX_ACTIONS=10
```

탐색 목표는 `다음 버튼으로 최종 이용료까지 확인`으로 설정한다. 수집 한도를 3장으로 설정하면 마지막 가격 화면이 수집되지 않는다. 선택 버튼 두 개는 모두 다음 화면으로 이동한다. 시스템 뒤로가기는 이전 화면으로 이동한다.

로컬 설치 및 개선 버전 확인:

```bash
adb install -r demo/android/build/darkaudit-demo.apk
adb shell am start -n com.darkaudit.demo/.MainActivity
adb shell am force-stop com.darkaudit.demo
adb shell am start -n com.darkaudit.demo/.MainActivity --ez clean true
```

재빌드에는 JDK 11+, Android SDK `platforms;android-34`, `build-tools;34.0.0`, `zip`이 필요하다.

```bash
ANDROID_SDK_ROOT=/path/to/android-sdk bash demo/android/build.sh
```

디버그 서명 키와 APK는 무시되는 `build/`에 생성된다. 실제 배포용 서명 키가 아니다. 빌드는 Android 공식 [서명 도구](https://developer.android.com/tools/apksigner)로 서명을 검증한다.

## 의도한 검출 사례

| 화면 | 규칙 | 다크패턴 버전 | 개선 버전 |
| --- | --- | --- | --- |
| 1 | DA-07 | 원금 손실·예금자보호 제외 문구가 작고 흐림 | 읽기 쉬운 크기와 대비 |
| 2 | DA-04 | 무료 선택사항 3개가 기본 체크됨 | 기본 체크 없음 |
| 3 | DA-03 | 수신 버튼은 크고 진함, 거절 버튼은 작고 흐림 | 같은 크기·색상 |
| 4 | DA-12 | 혜택 소멸·후회를 강조하는 문구 | 중립적인 선택 설명 |
| 1 → 5 | DA-15 | 총액 9,900원에서 필수 수수료를 더해 11,400원 | 첫 화면부터 총액·수수료 공개 |

이는 의도한 정답이며 모델의 실제 검출을 보장하는 수치가 아니다. `DARKAUDIT_PROVIDER=openai`, `VITE_USE_MOCKS=false`로 실행하고 발표 전에 실제 결과를 확인한다. 전체 15종 중 현재 지원되는 5종을 대상으로 한다.

## 이번 제작에서 확인한 내용

- 웹: 390×844에서 다크패턴·개선 버전 각각 5단계 이동, 체크박스 기본값, 가로 넘침 없음 확인.
- 공개 URL: HTTPS 응답, 스타일·스크립트 로드, 다음 화면 이동, URL 안전 정책 통과 확인.
- APK: 서명 검증, Android 11 에뮬레이터 설치·실행, 두 버전 각각 5단계 이동 확인.
- APK 탐색: 실제 `android_runner._tap_candidates`로 화면별 XML에서 버튼을 선택해 최종 화면까지 도달 확인.
- BrowserStack 원격 세션과 실제 AI 검출 결과는 이번 제작 검증에 포함하지 않았다.

APK를 임시 웹 서버에서도 내려받게 하려면 빌드 후 아래 명령을 실행한다. 이 임시 복사본은 Git에서 제외된다.

```bash
cp demo/android/build/darkaudit-demo.apk frontend/public/dark-pattern-demo/darkaudit-demo.apk
```

## 심사위원용 데모 버튼

새 진단 화면의 **입력 유형별 데모 체험**에서 URL·Figma·APK·스크린샷을 선택하면 진단 이름과 입력값이 채워진다. **분석 시작하기**는 기존의 실제 캡처·임포트·분석 API를 실행한다.

- URL: 백엔드의 `/demo/web/index.html?step=4`를 모바일 빠른 캡처로 검사한다. 임시 터널과 Vercel 로그인 보호에 의존하지 않는다.
- Figma: 기본 샘플 파일을 최상위 프레임 모드로 가져온다. `DARKAUDIT_DEMO_FIGMA_URL`로 다른 파일을 지정할 수 있으며, 빈 값이면 비활성화된다. 서버 토큰 계정에 파일 읽기 권한이 필요하다. 이 샘플의 전체 프레임 모드는 DA-15 화면 순서 검증용이 아니다.
- APK: `/demo/darkaudit-demo.apk`에서 파일을 자동으로 불러와 기존 업로드에 전달한다. `demo/assets/darkaudit-demo.apk`는 심사용으로 버전 관리하는 디버그 APK다. 재빌드 후 이 파일도 갱신한다. 서명 키는 계속 `build/`에만 보관한다.
- 외부 연동 설정이 없으면 해당 데모 버튼에 준비 상태를 표시한다. 심사 환경에는 `FIGMA_ACCESS_TOKEN`, `BROWSERSTACK_USERNAME`, `BROWSERSTACK_ACCESS_KEY`, `ANDROID_MAX_SCREENS=5`가 필요하다.

Docker 이미지에 웹 데모와 APK가 포함된다. 프론트엔드보다 백엔드를 먼저 배포하고 `/api/v1/demo-inputs`의 준비 상태를 확인한다. `VITE_USE_MOCKS=false` 및 실제 AI 제공자 설정을 사용한다. 로컬 API 주소는 URL 분석의 사설 네트워크 차단 대상이므로 URL 데모는 공개 배포된 API에서 실행한다.

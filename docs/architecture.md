# 시스템 구성도

> **초안입니다.** 멀티모달 분석(`ai/pipeline`, `ai/vision`, `ai/providers`) 부분은 뼈대만
> 그렸습니다. 실제 판단 단계와 프롬프트 구성은 담당자가 보강해 주세요. 보강이 필요한
> 지점은 각 절 끝에 `TODO`로 남겨 두었습니다.

## 1. 전체 구성

```mermaid
graph TB
    subgraph client["프런트엔드 · React + Vite"]
        UI["진단 생성 · 결과 검토 화면<br/>bbox 오버레이 · 회차 비교"]
    end

    subgraph api["백엔드 · FastAPI"]
        REST["REST API<br/>backend/api/main.py"]
        SVC["오케스트레이션<br/>backend/api/service.py"]
        RE["Rule Engine<br/>backend/app/rule_engine"]
        REG["회차 비교<br/>backend/app/regression.py"]
    end

    subgraph ai["분석 파이프라인 · ai/"]
        PIPE["BaselineAuditPipeline<br/>ai/pipeline/baseline.py"]
        PROV["Provider<br/>OpenAI Responses / Fake"]
        VIS["위치 검증<br/>ai/vision"]
    end

    subgraph store["저장소"]
        DB[("SQLite<br/>진단 · 회차 · 탐지")]
        FS[("data/<br/>업로드 · 캡처 이미지")]
    end

    UI -->|"진단 생성 · 화면 등록 · 분석 요청"| REST
    REST --> SVC
    SVC --> RE
    SVC --> PIPE
    PIPE --> PROV
    PIPE --> VIS
    SVC --> REG
    SVC --> DB
    SVC --> FS
    REST -->|"결과 · 근거 · 검사 상태"| UI
```

## 2. 입력 경로

입력마다 확보할 수 있는 근거가 다르고, 그에 따라 Rule Engine의 관여 범위가 달라집니다.

```mermaid
graph LR
    URL["URL 캡처<br/>Playwright"] -->|"스크린샷 + DOM"| DOM{"DOM 확보?"}
    SHOT["스크린샷 업로드"] -->|"이미지"| IMG["이미지 근거"]
    FIG["Figma 임포트"] -->|"프레임 + 노드"| IMG
    APK["Android APK<br/>BrowserStack"] -->|"스크린샷 + XML"| IMG

    DOM -->|"예"| RULEPATH["Rule Engine 후보 생성<br/>→ LLM 검증"]
    DOM -->|"아니오"| IMG
    IMG --> VISPATH["시각 분석<br/>→ 위치 후보 검증"]

    RULEPATH --> CONTRACT["증거 계약 검증"]
    VISPATH --> CONTRACT
    CONTRACT --> SAVE["결과 저장"]
```

| 입력 | 화면 확보 | Rule Engine | LLM이 새로 만들 수 있는 Finding |
| --- | --- | --- | --- |
| URL (DOM 확보) | Playwright 캡처 + DOM 추출 | 후보 생성 | 의미 판단 규칙만 (`DA-03`, `DA-12`) |
| URL (DOM 실패) · 스크린샷 · Figma · APK | 이미지 + OCR / 노드 / XML | 후보 없음 | MVP 5개 규칙 |

## 3. 분석 파이프라인

```mermaid
sequenceDiagram
    participant S as service.py
    participant R as Rule Engine
    participant P as BaselineAuditPipeline
    participant M as Multimodal Provider
    participant V as ai/vision
    participant D as DB

    S->>R: 화면 · UI 요소 전달
    R-->>S: deterministic 후보 (rule_id, 요소, 측정값)
    S->>P: 화면 이미지 + 후보
    P->>M: 프롬프트 + 이미지 + 후보 목록
    M-->>P: 후보 판정(KEEP/REJECT) + 의미 Finding + 규칙별 검사 상태
    P->>P: 출력 정제 · 증거 계약 검증
    P->>V: 작은 컨트롤 위치 후보 검증
    V-->>P: 확정 bbox
    P-->>S: 판정 결과 + telemetry
    S->>D: Finding · 근거 · 검사 상태 저장
```

### 출력 정제 단계

모델 출력은 신뢰하지 않고 계약에 맞게 정제합니다. 계약 위반 하나로 진단 전체가 실패하지
않도록, 스키마 불변식은 유지한 채 파서에서 손질합니다 (`ai/pipeline/response_parser.py`).

| 처리 | 이유 |
| --- | --- |
| 허용되지 않은 규칙의 의미 Finding 제거 | URL 경로는 deterministic 규칙을 후보로만 다룬다 |
| `severity` · `risk_name` 을 Rule Base 값으로 교정 | 조회표 값이라 모델 답변에 정보가 없다 |
| 단일 화면 규칙의 화면 목록 축소 | `DA-15` 를 뺀 규칙은 정의상 한 화면에서 판정한다 |

정제한 항목은 경고 로그와 `last_run_telemetry`에 남겨 모델이 계속 계약을 어기는지 추적합니다.

> **TODO (멀티모달 담당)**
> - 프롬프트 구성: 시스템 프롬프트 · 규칙 설명 · 후보 제시 방식을 어떤 순서로 넣는지
> - 판정 기준: KEEP/REJECT 를 가르는 근거 요건 (`ai/pipeline/assessment_contract.py`)
> - 재시도 전략: 스키마 실패와 증거 계약 실패를 어떻게 다르게 다루는지
> - `ai/vision` 의 후보 생성 채널(OCR · 색상 · 명암 · edge · shape)과 선택 방식

## 4. 근거 위치 확정

작은 컨트롤은 모델이 준 좌표를 그대로 쓰지 않고 별도로 검증합니다.

```mermaid
graph LR
    A["모델이 지목한 요소"] --> B["OCR 라벨 앵커"]
    B --> C["CV 후보 생성<br/>색상 · 명암 · edge · shape"]
    C --> D["확대 crop 에 C1, C2… 표식"]
    D --> E["모델이 후보 ID 선택"]
    E --> F["선택된 후보의 원본 좌표를 최종 bbox 로"]
    E -.->|"확정 실패"| G["경고 기록<br/>위치 미검증으로 표시"]
```

> **TODO (멀티모달 담당)** — 후보 생성 채널별 가중치, 실패 시 대체 경로, OCR 미설치 환경의
> 동작을 보강해 주세요.

## 5. 회차 비교 (Before/After)

```mermaid
graph LR
    V1["회차 v1<br/>Finding 집합"] --> FP["지문 생성<br/>규칙 + 화면 + 위치 격자"]
    V2["회차 v2<br/>Finding 집합"] --> FP
    FP --> CMP{"지문 일치?"}
    CMP -->|"v1 에만"| RES["해결"]
    CMP -->|"양쪽"| KEEP["유지 · 완화"]
    CMP -->|"v2 에만"| NEW["신규 · 재발"]
```

지문에는 모델이 쓴 서술을 넣지 않습니다. 같은 화면을 다시 분석해도 표현이 달라져, 고친 것이
없는데 "해결 + 신규"로 잡히기 때문입니다. DOM 텍스트가 있으면 그것을 쓰고, 없으면 위치로
식별합니다 (`backend/app/fingerprint.py`).

## 6. 배포

```mermaid
graph LR
    GH["GitHub<br/>sogeumbbang/DarkAudit"] -->|"main 머지"| RENDER["Render<br/>Docker · FastAPI + Chromium"]
    GH -->|"main 머지"| VERCEL["Vercel<br/>Vite 정적 빌드"]
    RENDER --- DISK[("영속 디스크<br/>/app/data")]
    VERCEL -->|"API 호출"| RENDER
```

절차와 환경 변수는 [배포 가이드](deploy.md)에 있습니다.

## 관련 문서

- [탐지 성능과 평가 방법](../README.md#탐지-성능)
- [규칙 정의](../rules/dark_pattern_rules.yaml) · [라벨링 가이드](labeling_guide.md)
- [분석 경로 결함 수정 기록](analysis_fixes_2026-09-06.md)

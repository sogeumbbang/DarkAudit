# DarkAudit 문서 안내

현재 사용·개발 문서는 2026-10-08에 커밋 `5748f51`의 소스와 대조했다. 이번 개정은 문서 갱신이며 운영 배포 확인이나 실모델 성능 재측정이 아니다.

## 사용·개발 문서

| 문서 | 내용 |
| --- | --- |
| [사용 안내](user-guide.md) | 입력 등록, 결과 검토, 수정본 재검사, 회차 선택, PDF, 삭제 보호 |
| [기능 명세](feature-spec.md) | 현재 구현 범위, 입력·API 계약, 비교 판정, 운영 한계 |
| [시스템 구성도](architecture.md) | 입력별 분석 경로, 모델 검증·위치 보정, 작업 저장과 비교 |
| [개발 안내](DEVELOPMENT.md) | 설치, 환경변수, CLI·API, 로컬 검증 명령 |
| [배포 가이드](deploy.md) | Render·Vercel 설정, 영속 저장, 대표 진단 관리 |
| [Figma 가져오기](figma_fastapi_handoff.md) | 서버 공용 PAT, 프레임·프로토타입 수집, 작업 오류 확인 |
| [챗봇](chatbot.md) | 문서·규칙 검색, 답변 형식, 위젯과 설정 |
| [데모 재검증](regression-demo.md) | 원본·일부 수정·전체 개선을 같은 진단에서 비교 |
| [라벨링 기준](labeling_guide.md) | 정답 라벨 형식·작성 기준과 독립 검수 상태 |
| [평가 요약](evaluation.md) | 측정일·모델별 결과와 한계 |
| [평가 실행 가이드](evaluation-framework.md) | 탐지·비교·설명·RAG 평가 명령과 지표 |

문서와 코드가 어긋나면 규칙은 `rules/dark_pattern_rules.yaml`, 입력·API 계약은 `ai/schemas/`와 `backend/api/`, 화면 동작은 `frontend/src/`를 확인한다. 현재 자동 탐지는 전체 15개 유형 중 5개이며 입력 상한은 웹 업로드·이미지 CLI·모델 요청 모두 6장이다.

## 측정·변경 이력

아래 파일은 당시 조건과 결과를 보존한다. 오래된 동작이나 입력 제한이 나와도 현재 서비스 명세로 사용하지 않는다.

- [평가 이력](eval-results.md): 반복 실험과 개선 전후 측정 기록.
- [2026-10-06 성능 측정](performance-measurement-2026-10-06.md): 당시 모델의 탐지·설명·RAG 결과.
- [2026-09-29 UI 점검](ui-audit-2026-09-29.md): 당시 화면 점검 기록.
- [2026-09-06 규칙 정렬](screenshot_rule_alignment_2026-09-06.md): 당시 스크린샷 계약 수정 기록.

`eval/`의 추적된 요약 JSON·보고서와 로컬에서 생성하는 예측 원본은 구분한다. 새 clone에는 Git에서 제외한 평가 원본이 없을 수 있다. `output/`·`outputs/`의 로컬 산출물도 Git 추적 대상이 아니다.

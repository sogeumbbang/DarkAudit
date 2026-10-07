# 다크패턴 챗봇 (RAG)

> 현재 구현 기준 · 2026-10-08

금융위원회·금융감독원 「온라인 금융상품 판매 관련 다크패턴 가이드라인」(2025.12)과 보도자료,
금융정책 게시글, 그리고 DarkAudit Rule Base(DA-01~DA-15)를 근거로 다크패턴 질문에 답하는
부가 기능이다. 주 사용자는 금융 앱 화면을 만드는 프론트엔드 개발자다. 진단(분석) 파이프라인과는
독립되어 있어, 끄거나 통째로 걷어내도 진단 기능에 영향이 없다.

## 구성

| 위치 | 역할 |
| --- | --- |
| `ai/knowledge/dark_pattern/*.md` | 원문 3건을 옮긴 코퍼스. `## ` 제목 단위로 청크가 나뉜다 |
| `ai/rag/rule_corpus.py` | `rules/dark_pattern_rules.yaml`을 질문 시점에 읽어 규칙별 청크(개요 + DA-01~15)로 만든다. 규칙 사본을 따로 두지 않는다 |
| `ai/rag/` | 청크 로딩, 검색(문자 bigram BM25 + OpenAI 임베딩 가중 RRF, `DA-03`처럼 번호를 물으면 해당 규칙 우선), 구조화 답변 생성 |
| `ai/tests/test_rag.py` | 코퍼스·검색·답변 단위 테스트 |
| `backend/api/chat.py` | `POST /api/v1/chat` 라우터와 요청/응답 스키마, on/off 스위치 |
| `backend/tests/test_chat.py` | API 테스트 |
| `frontend/src/features/chatbot/` | 위젯, 답변 카드(`ChatAnswerCard`), API 클라이언트, on/off 스위치, MSW 목업, 테스트 |

주요 연결 지점은 다음과 같다.

- `backend/api/main.py`: `from .chat import router as chat_router`, `app.include_router(chat_router)`
- `frontend/src/layouts/AppLayout.tsx`: 앱 화면의 `<ChatbotWidget />`
- `frontend/src/layouts/PublicLayout.tsx`: 랜딩 화면의 `<ChatbotWidget compact />`
- `frontend/src/mocks/handlers.ts`: `chatbotHandlers` import와 `...chatbotHandlers`

위젯은 화면 오른쪽 아래에 표시된다. 대화는 위젯의 메모리 상태에만 보관하고 최근 6개 메시지를 다음 요청의 `history`로 보낸다. 새로고침 후 복원하지 않으며 진단·업로드 이미지를 자동으로 첨부하지 않는다. API는 질문 최대 1,000자, 기록 최대 20개, 기록당 최대 4,000자를 받는다.

## 답변 형식

모델은 JSON Schema(Structured Outputs)로 아래 칸을 채우고, 화면은 칸별로 그린다.

| 칸 | 내용 |
| --- | --- |
| `summary` | 결론 1~2문장 |
| `relatedRules` | 관련 DA 규칙(최대 5개). 이름은 Rule Base에서 채운다 |
| `keyPoints` | 왜 문제인지, 무엇으로 판정하는지(설명문) |
| `checklist` | 화면에 바로 적용할 행동("~하세요"). 구현과 무관한 질문이면 비어 있다 |
| `citations` | 각 칸의 근거 번호. 실제로 인용된 근거만 `sources`로 내려간다 |

범위 밖 질문은 `inScope=false`와 `summary`만 채운다. 면책 문구는 화면 하단에 고정으로
보여주므로 답변에 넣지 않는다. `answer`에는 같은 내용을 텍스트로 이어 붙여 대화 기록에 쓴다.

## 설정

| 변수 | 위치 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `DARKAUDIT_CHATBOT_ENABLED` | 백엔드(Render) | `true` | `false`면 `/api/v1/chat`이 404를 돌려준다. 재시작만으로 반영 |
| `VITE_CHATBOT_ENABLED` | 프론트(Vercel) | `true` | `false`면 위젯을 그리지 않는다. 빌드 시점 값이라 재배포 필요 |
| `DARKAUDIT_CHAT_MODEL` | 백엔드 | `DARKAUDIT_MODEL` | 답변 생성 모델 |
| `DARKAUDIT_EMBEDDING_MODEL` | 백엔드 | `text-embedding-3-large` | 검색용 임베딩 모델 |

`DARKAUDIT_PROVIDER=fake`면 API 호출 없이 BM25 검색 결과를 그대로 보여준다.

## 끄기 (코드는 유지)

1. Vercel 환경변수에 `VITE_CHATBOT_ENABLED=false`를 넣고 재배포한다. 위젯이 사라진다.
2. Render 환경변수에 `DARKAUDIT_CHATBOT_ENABLED=false`를 넣는다. API가 404로 막힌다.

다시 켜려면 두 값을 지우거나 `true`로 되돌린다.

## 검증과 평가

```bash
python -m unittest ai.tests.test_rag backend.tests.test_chat -v
```

프런트 테스트는 `frontend/`에서 `npm run test -- src/features/chatbot`으로 실행한다. 답변·검색 품질 평가는 [평가 실행 가이드](evaluation-framework.md#4-rag-챗봇)를 따른다. UI 응답의 인용 excerpt만으로 전체 검색 품질을 계산하지 않고, `collect-rag`로 생성 모델에 전달한 검색 청크를 함께 저장한다.

2026-10-06의 12문항 측정은 [성능 보고서](performance-measurement-2026-10-06.md)에 있다. 해당 측정은 당시 모델과 개발용 질문 기준이며 이번 문서 개정에서 재측정하지 않았다.

챗봇은 진단 DB 테이블이나 대화 저장 파일을 만들지 않는다. 검색 색인은 메모리에 두며 `rules/dark_pattern_rules.yaml`은 진단 파이프라인과 공유하는 원본이다.

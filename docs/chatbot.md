# 다크패턴 챗봇 (RAG)

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

기존 코드와 맞닿는 곳은 아래 세 줄뿐이다.

- `backend/api/main.py`: `from .chat import router as chat_router`, `app.include_router(chat_router)`
- `frontend/src/layouts/AppLayout.tsx`: `ChatbotWidget` import와 `<ChatbotWidget />`
- `frontend/src/mocks/handlers.ts`: `chatbotHandlers` import와 `...chatbotHandlers`

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

## 완전히 제거

1. 파일/폴더 삭제

   ```bash
   git rm -r ai/rag ai/knowledge ai/tests/test_rag.py \
     backend/api/chat.py backend/tests/test_chat.py \
     frontend/src/features/chatbot docs/chatbot.md
   ```

2. 연결 코드 삭제 (위 "기존 코드와 맞닿는 곳" 세 파일에서 챗봇 줄 제거)
3. 설정 정리
   - `.env.example`의 `DARKAUDIT_CHAT*`, `DARKAUDIT_EMBEDDING_MODEL` 줄
   - `docs/deploy.md` 환경변수 표의 챗봇 행
   - `frontend/src/vite-env.d.ts`의 `VITE_CHATBOT_ENABLED` 줄
   - Render/Vercel 대시보드의 챗봇 환경변수
4. 확인

   ```bash
   git grep -n -i "chatbot\|/api/v1/chat\|ai.rag"   # 결과가 없어야 한다
   python -m unittest discover -s backend/tests -v
   cd frontend && npm run lint && npm run test && npm run build
   ```

`rules/dark_pattern_rules.yaml`은 진단 파이프라인의 원본이므로 지우지 않는다(챗봇은 읽기만 한다).
DB 테이블이나 저장 파일은 만들지 않으므로(임베딩 색인은 메모리에만 둔다) 데이터 정리는 필요 없다.

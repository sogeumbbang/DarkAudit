"""Answer dark-pattern questions from the guideline documents only."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from ai.config import AISettings

from .corpus import Chunk, load_chunks
from .retriever import HybridRetriever, LexicalRetriever, Retriever, ScoredChunk

TOP_K = 5
MAX_HISTORY_TURNS = 6
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large"

SYSTEM_PROMPT = """너는 DarkAudit의 금융 다크패턴 안내 챗봇이다.
금융위원회·금융감독원의 「온라인 금융상품 판매 관련 다크패턴 가이드라인」(2025.12)과
관련 보도자료만을 근거로 한국어로 답한다.

규칙:
- 아래 [근거] 블록에 있는 내용만 사용한다. 근거에 없는 사실, 조문, 수치, 사례를 지어내지 않는다.
- 문장이나 문단 끝에 사용한 근거 번호를 [1], [2]처럼 붙인다.
- 근거로 답할 수 없는 질문이면 "제공된 가이드라인 문서에서는 해당 내용을 찾지 못했습니다."라고
  말하고, 다크패턴 관련해 물어볼 수 있는 방향을 한 줄로 안내한다. 이때는 근거 번호를 붙이지 않는다.
- 다크패턴과 무관한 요청(일반 잡담, 코드 작성, 투자 추천 등)은 근거 번호 없이 정중히 범위 밖이라고 답한다.
- 특정 회사·화면이 위반인지 단정하지 않는다. 가이드라인 기준으로 해당 가능성이 있는 유형과
  판단 포인트를 설명하고, 최종 판단은 관련 부서 검토가 필요하다고 덧붙인다.
- 답변은 핵심부터 간결하게, 필요하면 짧은 목록을 쓴다. 마크다운 제목(#)은 쓰지 않는다."""

NOT_FOUND_ANSWER = (
    "제공된 가이드라인 문서에서는 해당 내용을 찾지 못했습니다. "
    "다크패턴 유형(예: 특정옵션 사전선택, 반복간섭)이나 적용대상·시행시기를 물어봐 주세요."
)


@dataclass(frozen=True, slots=True)
class ChatTurn:
    role: Literal["user", "assistant"]
    content: str


@dataclass(frozen=True, slots=True)
class ChatSource:
    index: int
    title: str
    section: str
    source_file: str
    excerpt: str


@dataclass(frozen=True, slots=True)
class ChatAnswer:
    answer: str
    sources: tuple[ChatSource, ...]


class AnswerGenerator(Protocol):
    def generate(self, question: str, history: list[ChatTurn], context: list[ScoredChunk]) -> str: ...


def _context_block(context: list[ScoredChunk]) -> str:
    return "\n\n".join(
        f"[{index}] {item.chunk.source_title} > {item.chunk.section}\n{item.chunk.text}"
        for index, item in enumerate(context, start=1)
    )


class OpenAIAnswerGenerator:
    def __init__(self, model: str, client: Any | None = None) -> None:
        if client is None:
            from openai import OpenAI
            client = OpenAI()
        self.model = model
        self.client = client

    def generate(self, question: str, history: list[ChatTurn], context: list[ScoredChunk]) -> str:
        messages: list[dict[str, str]] = [
            {"role": turn.role, "content": turn.content} for turn in history
        ]
        messages.append({
            "role": "user",
            "content": f"[근거]\n{_context_block(context)}\n\n[질문]\n{question}",
        })
        response = self.client.responses.create(
            model=self.model, instructions=SYSTEM_PROMPT, input=messages
        )
        text = (getattr(response, "output_text", None) or "").strip()
        if not text:
            raise RuntimeError("Model returned no output_text")
        return text


class ExtractiveAnswerGenerator:
    """API 키 없는 로컬 데모용. 검색된 근거를 그대로 요약 없이 보여준다."""

    def generate(self, question: str, history: list[ChatTurn], context: list[ScoredChunk]) -> str:
        lines = ["가이드라인 문서에서 찾은 관련 내용입니다."]
        for index, item in enumerate(context[:2], start=1):
            first = item.chunk.text.split("\n\n", 1)[0].lstrip("- ")
            lines.append(f"- {item.chunk.section}: {first} [{index}]")
        return "\n".join(lines)


def _excerpt(chunk: Chunk, limit: int = 220) -> str:
    text = " ".join(chunk.text.split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


class DarkPatternChatbot:
    def __init__(self, retriever: Retriever, generator: AnswerGenerator) -> None:
        self.retriever = retriever
        self.generator = generator

    def ask(self, question: str, history: list[ChatTurn] | None = None) -> ChatAnswer:
        question = question.strip()
        history = (history or [])[-MAX_HISTORY_TURNS:]
        # "그럼 예시는?" 같은 후속 질문은 단독으로 검색이 안 되므로 직전 질문을 붙인다.
        previous = next((turn.content for turn in reversed(history) if turn.role == "user"), "")
        context = self.retriever.search(f"{previous}\n{question}".strip(), TOP_K)
        if not context:
            return ChatAnswer(NOT_FOUND_ANSWER, ())
        answer = self.generator.generate(question, history, context)
        # 검색은 항상 TOP_K 개를 가져오지만, 답변이 실제로 인용한 근거만 보여준다.
        # 범위 밖 질문에 무관한 근거가 붙어 보이는 것을 막는다.
        cited = {int(number) for number in re.findall(r"\[(\d+)\]", answer)}
        sources = tuple(
            ChatSource(index, item.chunk.source_title, item.chunk.section,
                       item.chunk.source_file, _excerpt(item.chunk))
            for index, item in enumerate(context, start=1)
            if index in cited
        )
        return ChatAnswer(answer, sources)


def create_chatbot(settings: AISettings | None = None) -> DarkPatternChatbot:
    settings = settings or AISettings.from_env()
    chunks = load_chunks()
    if settings.provider == "fake":
        return DarkPatternChatbot(LexicalRetriever(chunks), ExtractiveAnswerGenerator())
    if settings.provider == "openai":
        model = os.getenv("DARKAUDIT_CHAT_MODEL") or settings.model
        if not model:
            raise ValueError("DARKAUDIT_CHAT_MODEL or DARKAUDIT_MODEL is required for the chatbot")
        embedding_model = os.getenv("DARKAUDIT_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL
        return DarkPatternChatbot(
            HybridRetriever(chunks, embedding_model), OpenAIAnswerGenerator(model)
        )
    raise ValueError(f"Unsupported DARKAUDIT_PROVIDER: {settings.provider}")

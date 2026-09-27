"""RAG chatbot answering questions about the financial dark-pattern guideline."""

from __future__ import annotations

import logging
from functools import lru_cache

from fastapi import APIRouter, HTTPException

from ai.rag import ChatTurn, DarkPatternChatbot, create_chatbot

from .schemas import ChatRequest, ChatResponseDto, ChatSourceDto

router = APIRouter()
logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def get_chatbot() -> DarkPatternChatbot:
    # 임베딩 색인을 요청마다 다시 만들지 않도록 프로세스당 하나만 둔다.
    return create_chatbot()


@router.post("/api/v1/chat", response_model=ChatResponseDto)
def chat(payload: ChatRequest) -> ChatResponseDto:
    if not payload.message.strip():
        raise HTTPException(422, "질문을 입력해주세요.")
    try:
        chatbot = get_chatbot()
    except ValueError as exc:
        raise HTTPException(503, f"챗봇 설정이 올바르지 않습니다: {exc}") from exc
    history = [ChatTurn(turn.role, turn.content) for turn in payload.history]
    try:
        result = chatbot.ask(payload.message, history)
    except Exception as exc:
        logger.exception("chatbot request failed")
        raise HTTPException(502, "답변을 생성하지 못했습니다. 잠시 후 다시 시도해주세요.") from exc
    return ChatResponseDto(
        answer=result.answer,
        sources=[
            ChatSourceDto(index=source.index, title=source.title, section=source.section,
                          sourceFile=source.source_file, excerpt=source.excerpt)
            for source in result.sources
        ],
    )

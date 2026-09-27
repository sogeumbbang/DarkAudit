"""RAG chatbot answering questions about the financial dark-pattern guideline.

챗봇은 진단 기능과 독립된 부가 기능이다. 끄거나 걷어낼 때를 위해 요청/응답
스키마까지 이 파일에 모아 두고, 공용 모듈(schemas.py 등)에는 흔적을 남기지 않는다.
제거 절차는 docs/chatbot.md 참고.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ai.rag import AnswerPoint, ChatTurn, DarkPatternChatbot, create_chatbot

router = APIRouter()
logger = logging.getLogger(__name__)


class ChatTurnDto(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=1000)
    history: list[ChatTurnDto] = Field(default_factory=list, max_length=20)


class ChatSourceDto(BaseModel):
    index: int
    title: str
    section: str
    sourceFile: str
    excerpt: str


class ChatPointDto(BaseModel):
    text: str
    citations: list[int]


class ChatRuleDto(BaseModel):
    ruleId: str
    name: str


class ChatStructuredDto(BaseModel):
    inScope: bool
    summary: str
    summaryCitations: list[int]
    relatedRules: list[ChatRuleDto]
    keyPoints: list[ChatPointDto]
    checklist: list[ChatPointDto]


class ChatResponseDto(BaseModel):
    # answer 는 구조화 칸을 이어 붙인 텍스트다. 대화 기록으로 되돌려 보내거나
    # structured 를 그리지 못하는 클라이언트가 쓴다.
    answer: str
    structured: ChatStructuredDto
    sources: list[ChatSourceDto]


def _points(points: tuple[AnswerPoint, ...]) -> list[ChatPointDto]:
    return [ChatPointDto(text=p.text, citations=list(p.citations)) for p in points]


def chatbot_enabled() -> bool:
    # 요청마다 읽어 재배포 없이 환경변수만 바꿔 재시작하면 꺼지게 한다.
    return os.getenv("DARKAUDIT_CHATBOT_ENABLED", "true").strip().lower() not in {"0", "false", "off", "no"}


@lru_cache(maxsize=1)
def get_chatbot() -> DarkPatternChatbot:
    # 임베딩 색인을 요청마다 다시 만들지 않도록 프로세스당 하나만 둔다.
    return create_chatbot()


@router.post("/api/v1/chat", response_model=ChatResponseDto)
def chat(payload: ChatRequest) -> ChatResponseDto:
    if not chatbot_enabled():
        raise HTTPException(404, "챗봇 기능이 비활성화되어 있습니다.")
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
    structured = result.structured
    return ChatResponseDto(
        answer=result.answer,
        structured=ChatStructuredDto(
            inScope=structured.in_scope,
            summary=structured.summary,
            summaryCitations=list(structured.summary_citations),
            relatedRules=[ChatRuleDto(ruleId=r.rule_id, name=r.name) for r in result.related_rules],
            keyPoints=_points(structured.key_points),
            checklist=_points(structured.checklist),
        ),
        sources=[
            ChatSourceDto(index=source.index, title=source.title, section=source.section,
                          sourceFile=source.source_file, excerpt=source.excerpt)
            for source in result.sources
        ],
    )

"""Answer dark-pattern questions from the guideline documents and the DarkAudit Rule Base.

답변은 자유 텍스트가 아니라 고정된 칸(요약·관련 규칙·판단 기준·구현 체크리스트)으로
받는다. 주 사용자인 프론트엔드 개발자가 매번 같은 모양으로 훑어볼 수 있어야 하고,
화면도 그 칸에 맞춰 정돈해 그릴 수 있기 때문이다.
"""
from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from typing import Any, Literal, Protocol

from ai.config import AISettings

from .corpus import Chunk, load_chunks
from .retriever import HybridRetriever, LexicalRetriever, Retriever, ScoredChunk
from .rule_corpus import load_rule_chunks

TOP_K = 6
MAX_HISTORY_TURNS = 6
MAX_RELATED_RULES = 5
DEFAULT_EMBEDDING_MODEL = "text-embedding-3-large"

SYSTEM_PROMPT = """너는 DarkAudit의 '다크패턴 가이드' 챗봇이다.
주 사용자는 금융 앱·웹 화면을 만드는 프론트엔드 개발자와 디자이너다.
[근거] 블록(금융위·금감원 「온라인 금융상품 판매 관련 다크패턴 가이드라인」(2025.12), 보도자료,
DarkAudit Rule Base DA-01~DA-15)만 사용해 한국어로 답한다.

가이드라인 유형과 DarkAudit 규칙 번호의 대응(고정):
오도형 ① 설명절차의 과도한 축약=DA-01, ② 속임수 질문=DA-02, ③ 잘못된 계층구조=DA-03,
④ 특정옵션의 사전선택=DA-04, ⑤ 허위광고 및 기만적인 유인행위=DA-05,
방해형 ⑥ 취소·탈퇴 등의 방해=DA-06, ⑦ 숨겨진 정보=DA-07, ⑧ 가격비교 방해=DA-08, ⑨ 클릭 피로감 유발=DA-09,
압박형 ⑩ 계약과정 중 기습적 광고=DA-10, ⑪ 반복간섭=DA-11, ⑫ 감정적 언어사용=DA-12, ⑬ 감각조작=DA-13,
⑭ 다른 소비자의 활동 알림=DA-14, 편취유도형 ⑮ 순차공개 가격책정=DA-15.

출력 칸 작성법:
- summary: 질문에 대한 결론을 1~2문장으로. 인사말, 질문 되풀이, 면책 문구를 쓰지 않는다.
- related_rules: 답과 직접 관련된 규칙만 최대 5개. 없으면 빈 배열.
- key_points: 왜 문제가 되는지, 무엇을 보고 해당 여부를 판정하는지 같은 설명 2~4개.
  "~입니다/~해당합니다"로 끝나는 설명문으로 쓰고, 한 항목에 한 가지 내용만 한 문장으로 쓴다.
  근거에 수치 기준(예: 면적비 1.5 이상)이나 체크 항목이 있으면 그대로 살려 쓴다.
- checklist: 개발자가 화면에 바로 적용할 행동 0~4개. "~하세요"로 끝나는 구체적인 문장으로 쓰고,
  기본값, 버튼 크기·색 대비, 팝업 노출 시점, 문구 같은 UI 용어를 쓴다.
  시행시기·적용대상처럼 구현과 무관한 질문이면 빈 배열로 둔다.
- key_points에는 행동 지시를 쓰지 않고, key_points와 checklist에 같은 내용을 반복하지 않는다.
- citations: 각 항목이 근거로 삼은 [근거] 번호. 근거 없는 항목은 만들지 않는다.
  번호는 citations 칸에만 넣고 summary나 text 문장 안에 [1] 같은 표기를 쓰지 않는다.

지켜야 할 것:
- 근거에 없는 사실, 조문, 수치, 사례를 지어내지 않는다.
- 특정 회사·화면이 위반이라고 단정하지 않고 "해당할 수 있습니다"처럼 가능성으로 말한다.
  최종 판단은 사람이 검토한다는 안내는 화면이 따로 보여주므로 답변에 쓰지 않는다.
- 근거로 답할 수 없거나 다크패턴과 무관한 요청(잡담, 코드 작성, 투자 추천 등)이면
  in_scope=false, summary에 범위 밖이라는 한 문장과 물어볼 수 있는 예시 한 문장을 쓰고 나머지는 빈 배열로 둔다.
- 간결한 존댓말을 쓰고 마크다운 기호(**, #, -)를 쓰지 않는다."""

NOT_FOUND_SUMMARY = (
    "제공된 가이드라인과 규칙 문서에서는 해당 내용을 찾지 못했습니다. "
    "다크패턴 유형(예: DA-04 특정옵션의 사전선택)이나 적용대상·시행시기를 물어봐 주세요."
)

_POINT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["text", "citations"],
    "properties": {
        "text": {"type": "string"},
        "citations": {"type": "array", "items": {"type": "integer"}},
    },
}
ANSWER_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["in_scope", "summary", "summary_citations", "related_rules", "key_points", "checklist"],
    "properties": {
        "in_scope": {"type": "boolean"},
        "summary": {"type": "string"},
        "summary_citations": {"type": "array", "items": {"type": "integer"}},
        "related_rules": {
            "type": "array",
            "items": {"type": "string", "enum": [f"DA-{n:02d}" for n in range(1, 16)]},
        },
        "key_points": {"type": "array", "items": _POINT_SCHEMA},
        "checklist": {"type": "array", "items": _POINT_SCHEMA},
    },
}


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
class AnswerPoint:
    text: str
    citations: tuple[int, ...] = ()


@dataclass(frozen=True, slots=True)
class RuleRef:
    rule_id: str
    name: str


@dataclass(frozen=True, slots=True)
class StructuredAnswer:
    in_scope: bool
    summary: str
    summary_citations: tuple[int, ...] = ()
    related_rules: tuple[str, ...] = ()
    key_points: tuple[AnswerPoint, ...] = ()
    checklist: tuple[AnswerPoint, ...] = ()


@dataclass(frozen=True, slots=True)
class ChatAnswer:
    answer: str
    sources: tuple[ChatSource, ...]
    structured: StructuredAnswer
    related_rules: tuple[RuleRef, ...] = ()


class AnswerGenerator(Protocol):
    def generate(
        self, question: str, history: list[ChatTurn], context: list[ScoredChunk]
    ) -> StructuredAnswer: ...


def _context_block(context: list[ScoredChunk]) -> str:
    return "\n\n".join(
        f"[{index}] {item.chunk.source_title} > {item.chunk.section}\n{item.chunk.text}"
        for index, item in enumerate(context, start=1)
    )


def _clean_text(text: Any) -> str:
    # 번호는 citations 칸으로 따로 받는다. 문장 안에도 [1]을 쓰면 화면에 두 번 찍힌다.
    return re.sub(r"\s*\[\d+\]", "", str(text)).strip()


def _points(items: list[dict[str, Any]]) -> tuple[AnswerPoint, ...]:
    return tuple(
        AnswerPoint(_clean_text(item["text"]), tuple(int(c) for c in item.get("citations", [])))
        for item in items
        if _clean_text(item.get("text", ""))
    )


def parse_structured(raw: dict[str, Any]) -> StructuredAnswer:
    return StructuredAnswer(
        in_scope=bool(raw["in_scope"]),
        summary=_clean_text(raw["summary"]),
        summary_citations=tuple(int(c) for c in raw.get("summary_citations", [])),
        related_rules=tuple(dict.fromkeys(str(r) for r in raw.get("related_rules", []))),
        key_points=_points(raw.get("key_points", [])),
        checklist=_points(raw.get("checklist", [])),
    )


class OpenAIAnswerGenerator:
    def __init__(self, model: str, client: Any | None = None) -> None:
        if client is None:
            from openai import OpenAI
            client = OpenAI()
        self.model = model
        self.client = client

    def generate(
        self, question: str, history: list[ChatTurn], context: list[ScoredChunk]
    ) -> StructuredAnswer:
        messages: list[dict[str, str]] = [
            {"role": turn.role, "content": turn.content} for turn in history
        ]
        messages.append({
            "role": "user",
            "content": f"[근거]\n{_context_block(context)}\n\n[질문]\n{question}",
        })
        response = self.client.responses.create(
            model=self.model,
            instructions=SYSTEM_PROMPT,
            input=messages,
            text={"format": {"type": "json_schema", "name": "darkaudit_chat_answer",
                             "schema": ANSWER_SCHEMA, "strict": True}},
        )
        text = (getattr(response, "output_text", None) or "").strip()
        if not text:
            raise RuntimeError("Model returned no output_text")
        return parse_structured(json.loads(text))


def _first_sentence(text: str) -> str:
    body = " ".join(text.replace("- ", " ").split())
    match = re.search(r"^(.+?[다함음]\.)", body)
    return match.group(1) if match else body[:160]


class ExtractiveAnswerGenerator:
    """API 키 없는 로컬 데모용. 검색된 근거의 첫 문장을 칸에 채워 보여준다."""

    def generate(
        self, question: str, history: list[ChatTurn], context: list[ScoredChunk]
    ) -> StructuredAnswer:
        rules = tuple(
            item.chunk.id.removeprefix("rules-") for item in context
            if re.fullmatch(r"rules-DA-\d{2}", item.chunk.id)
        )
        return StructuredAnswer(
            in_scope=True,
            summary=f"가이드라인 문서에서 찾은 관련 내용입니다. {_first_sentence(context[0].chunk.text)}",
            summary_citations=(1,),
            related_rules=rules[:MAX_RELATED_RULES],
            key_points=tuple(
                AnswerPoint(f"{item.chunk.section}: {_first_sentence(item.chunk.text)}", (index,))
                for index, item in enumerate(context[1:3], start=2)
            ),
        )


def _excerpt(chunk: Chunk, limit: int = 220) -> str:
    text = " ".join(chunk.text.split())
    return text if len(text) <= limit else text[:limit].rstrip() + "…"


def _render_plain(answer: StructuredAnswer, rules: tuple[RuleRef, ...]) -> str:
    """대화 기록과 구조화 응답을 못 그리는 클라이언트용 텍스트."""
    def cite(citations: tuple[int, ...]) -> str:
        return "".join(f"[{c}]" for c in citations)

    lines = [f"{answer.summary} {cite(answer.summary_citations)}".strip()]
    if rules:
        lines.append("관련 규칙: " + ", ".join(f"{r.rule_id} {r.name}" for r in rules))
    for title, points in (("핵심 내용", answer.key_points), ("구현 체크리스트", answer.checklist)):
        if points:
            lines.append(f"{title}:")
            lines.extend(f"- {p.text} {cite(p.citations)}".rstrip() for p in points)
    return "\n".join(lines)


class DarkPatternChatbot:
    def __init__(self, retriever: Retriever, generator: AnswerGenerator,
                 rule_names: dict[str, str] | None = None) -> None:
        self.retriever = retriever
        self.generator = generator
        self.rule_names = rule_names or {}

    def ask(self, question: str, history: list[ChatTurn] | None = None) -> ChatAnswer:
        question = question.strip()
        history = (history or [])[-MAX_HISTORY_TURNS:]
        # "그럼 예시는?" 같은 후속 질문은 단독으로 검색이 안 되므로 직전 질문을 붙인다.
        previous = next((turn.content for turn in reversed(history) if turn.role == "user"), "")
        context = self.retriever.search(f"{previous}\n{question}".strip(), TOP_K)
        if not context:
            empty = StructuredAnswer(in_scope=False, summary=NOT_FOUND_SUMMARY)
            return ChatAnswer(NOT_FOUND_SUMMARY, (), empty)
        answer = self._sanitize(self.generator.generate(question, history, context), len(context))
        cited = set(answer.summary_citations)
        for point in (*answer.key_points, *answer.checklist):
            cited.update(point.citations)
        # 검색은 항상 TOP_K 개를 가져오지만, 답변이 실제로 인용한 근거만 보여준다.
        sources = tuple(
            ChatSource(index, item.chunk.source_title, item.chunk.section,
                       item.chunk.source_file, _excerpt(item.chunk))
            for index, item in enumerate(context, start=1)
            if index in cited
        )
        rules = tuple(RuleRef(rid, self.rule_names.get(rid, "")) for rid in answer.related_rules)
        return ChatAnswer(_render_plain(answer, rules), sources, answer, rules)

    def _sanitize(self, answer: StructuredAnswer, context_size: int) -> StructuredAnswer:
        """모델이 없는 근거 번호나 규칙을 내면 걸러낸다."""
        def valid(citations: tuple[int, ...]) -> tuple[int, ...]:
            return tuple(dict.fromkeys(c for c in citations if 1 <= c <= context_size))

        def clean(points: tuple[AnswerPoint, ...]) -> tuple[AnswerPoint, ...]:
            return tuple(AnswerPoint(p.text, valid(p.citations)) for p in points)

        if not answer.in_scope:
            return StructuredAnswer(in_scope=False, summary=answer.summary or NOT_FOUND_SUMMARY)
        rules = tuple(r for r in answer.related_rules if not self.rule_names or r in self.rule_names)
        return StructuredAnswer(
            in_scope=True,
            summary=answer.summary,
            summary_citations=valid(answer.summary_citations),
            related_rules=rules[:MAX_RELATED_RULES],
            key_points=clean(answer.key_points),
            checklist=clean(answer.checklist),
        )


def _rule_names(chunks: list[Chunk]) -> dict[str, str]:
    names = {}
    for chunk in chunks:
        match = re.fullmatch(r"(DA-\d{2}) (.+) \(.+\)", chunk.section)
        if chunk.id.startswith("rules-") and match:
            names[match.group(1)] = match.group(2)
    return names


def create_chatbot(settings: AISettings | None = None) -> DarkPatternChatbot:
    settings = settings or AISettings.from_env()
    chunks = [*load_chunks(), *load_rule_chunks()]
    names = _rule_names(chunks)
    if settings.provider == "fake":
        return DarkPatternChatbot(LexicalRetriever(chunks), ExtractiveAnswerGenerator(), names)
    if settings.provider == "openai":
        model = os.getenv("DARKAUDIT_CHAT_MODEL") or settings.model
        if not model:
            raise ValueError("DARKAUDIT_CHAT_MODEL or DARKAUDIT_MODEL is required for the chatbot")
        embedding_model = os.getenv("DARKAUDIT_EMBEDDING_MODEL") or DEFAULT_EMBEDDING_MODEL
        return DarkPatternChatbot(
            HybridRetriever(chunks, embedding_model), OpenAIAnswerGenerator(model), names
        )
    raise ValueError(f"Unsupported DARKAUDIT_PROVIDER: {settings.provider}")

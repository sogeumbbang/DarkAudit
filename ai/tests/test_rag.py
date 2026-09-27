import json
import unittest
from types import SimpleNamespace

from ai.config import AISettings
from ai.rag.chatbot import (
    ANSWER_SCHEMA,
    NOT_FOUND_SUMMARY,
    AnswerPoint,
    ChatTurn,
    DarkPatternChatbot,
    ExtractiveAnswerGenerator,
    OpenAIAnswerGenerator,
    StructuredAnswer,
    create_chatbot,
)
from ai.rag.corpus import load_chunks
from ai.rag.retriever import HybridRetriever, LexicalRetriever
from ai.rag.rule_corpus import load_rule_chunks


class CorpusTest(unittest.TestCase):
    def test_all_three_documents_are_chunked_with_sections(self):
        chunks = load_chunks()
        self.assertEqual(
            {chunk.source_file for chunk in chunks},
            {
                "251224[별첨] 온라인 금융상품 판매 관련 다크패턴 가이드라인.pdf",
                "251224(보도자료) 온라인 금융상품 판매 관련 다크패턴 가이드라인 마련.pdf",
                "금융정책.txt",
            },
        )
        self.assertEqual(len({chunk.id for chunk in chunks}), len(chunks))
        self.assertTrue(all(chunk.section and chunk.text for chunk in chunks))


class LexicalRetrieverTest(unittest.TestCase):
    def setUp(self):
        self.retriever = LexicalRetriever(load_chunks())

    def test_finds_the_matching_guideline_type(self):
        cases = {
            "특정옵션 사전선택이 뭐야?": "특정옵션의 사전선택",
            "리볼빙을 부담스러우세요로 유도하면?": "감정적 언어사용",
            "반복간섭에서 반복의 기준은?": "반복간섭",
        }
        for question, section in cases.items():
            with self.subTest(question=question):
                self.assertIn(section, self.retriever.search(question, 3)[0].chunk.section)

    def test_drops_near_duplicate_chunks_from_the_press_release_copies(self):
        results = self.retriever.search("가이드라인 시행시기와 향후 추진계획", 5)
        schedule = [item for item in results if "시행시기" in item.chunk.section]
        self.assertEqual(len(schedule), 1)

    def test_unrelated_question_returns_nothing(self):
        self.assertEqual(self.retriever.search("오늘 날씨 어때", 5), [])


class RuleCorpusTest(unittest.TestCase):
    def test_every_rule_in_the_yaml_becomes_a_chunk(self):
        chunks = load_rule_chunks()
        ids = [chunk.id for chunk in chunks]
        self.assertEqual(ids[0], "rules-overview")
        self.assertEqual(ids[1:], [f"rules-DA-{n:02d}" for n in range(1, 16)])
        da03 = chunks[3]
        self.assertEqual(da03.section, "DA-03 잘못된 계층구조 (오도형 ③)")
        self.assertIn("area_ratio: 대립 선택지 간 면적비 (기준 >= 1.5)", da03.text)
        self.assertIn("현재 자동 탐지 대상 여부: 예", da03.text)
        self.assertIn("DA-02 속임수 질문", da03.text)
        self.assertIn("현재 자동 탐지 대상 여부: 아니요", chunks[1].text)

    def test_rule_ids_are_searchable(self):
        retriever = LexicalRetriever([*load_chunks(), *load_rule_chunks()])
        self.assertEqual(retriever.search("DA-03 기준이 뭐야?", 1)[0].chunk.id, "rules-DA-03")
        self.assertEqual(retriever.search("DA-11 반복간섭 판정", 1)[0].chunk.id, "rules-DA-11")
        compared = [item.chunk.id for item in retriever.search("DA-12랑 da13 차이", 2)]
        self.assertEqual(compared, ["rules-DA-12", "rules-DA-13"])


class StubGenerator:
    def __init__(self, answer):
        self.answer = answer

    def generate(self, *args):
        return self.answer


class ChatbotTest(unittest.TestCase):
    def setUp(self):
        self.retriever = LexicalRetriever([*load_chunks(), *load_rule_chunks()])

    def test_fake_chatbot_fills_structured_answer_with_rules_and_sources(self):
        result = create_chatbot(AISettings("fake", None)).ask("DA-03 잘못된 계층구조 예시 알려줘")
        self.assertTrue(result.structured.in_scope)
        self.assertEqual(result.structured.summary_citations, (1,))
        self.assertIn(("DA-03", "잘못된 계층구조"), [(r.rule_id, r.name) for r in result.related_rules])
        self.assertTrue(result.sources)
        self.assertIn("[1]", result.answer)
        self.assertIn("관련 규칙: DA-03 잘못된 계층구조", result.answer)

    def test_drops_invalid_citations_and_unknown_rules_and_returns_only_cited_sources(self):
        answer = StructuredAnswer(
            in_scope=True, summary="요약", summary_citations=(2, 99),
            related_rules=("DA-11", "DA-99"),
            key_points=(AnswerPoint("기준", (3, 0)),), checklist=(AnswerPoint("하세요", (3,)),),
        )
        chatbot = DarkPatternChatbot(self.retriever, StubGenerator(answer), {"DA-11": "반복간섭"})
        result = chatbot.ask("반복간섭")
        self.assertEqual(result.structured.summary_citations, (2,))
        self.assertEqual(result.structured.key_points[0].citations, (3,))
        self.assertEqual([r.rule_id for r in result.related_rules], ["DA-11"])
        self.assertEqual([source.index for source in result.sources], [2, 3])
        self.assertEqual(
            result.answer,
            "요약 [2]\n관련 규칙: DA-11 반복간섭\n핵심 내용:\n- 기준 [3]\n구현 체크리스트:\n- 하세요 [3]",
        )

    def test_out_of_scope_answer_has_no_sources_or_sections(self):
        answer = StructuredAnswer(in_scope=False, summary="범위 밖입니다.", summary_citations=(1,),
                                  key_points=(AnswerPoint("x", (1,)),))
        result = DarkPatternChatbot(self.retriever, StubGenerator(answer)).ask("반복간섭")
        self.assertEqual(result.structured, StructuredAnswer(in_scope=False, summary="범위 밖입니다."))
        self.assertEqual(result.sources, ())

    def test_unrelated_question_gets_not_found_without_calling_generator(self):
        class FailingGenerator:
            def generate(self, *args):
                raise AssertionError("generator must not run without context")

        result = DarkPatternChatbot(self.retriever, FailingGenerator()).ask("오늘 날씨 어때")
        self.assertEqual(result.answer, NOT_FOUND_SUMMARY)
        self.assertFalse(result.structured.in_scope)

    def test_follow_up_question_is_searched_with_previous_question(self):
        seen = []

        class RecordingRetriever:
            def search(self, query, k):
                seen.append(query)
                return []

        DarkPatternChatbot(RecordingRetriever(), ExtractiveAnswerGenerator()).ask(
            "예시도 알려줘",
            [ChatTurn("user", "반복간섭이 뭐야?"), ChatTurn("assistant", "...")],
        )
        self.assertIn("반복간섭", seen[0])
        self.assertIn("예시도", seen[0])

    def test_openai_generator_requests_strict_schema_and_parses_it(self):
        calls = []
        payload = {
            "in_scope": True, "summary": "요약입니다.[1] [2]", "summary_citations": [1],
            "related_rules": ["DA-11", "DA-11"],
            "key_points": [{"text": "기준", "citations": [1]}, {"text": " ", "citations": []}],
            "checklist": [{"text": "팝업을 다시 띄우지 마세요", "citations": [1]}],
        }
        client = SimpleNamespace(responses=SimpleNamespace(
            create=lambda **kwargs: calls.append(kwargs)
            or SimpleNamespace(output_text=json.dumps(payload, ensure_ascii=False))
        ))
        context = self.retriever.search("반복간섭", 2)
        answer = OpenAIAnswerGenerator("test-model", client).generate(
            "반복간섭이 뭐야?", [ChatTurn("user", "안녕"), ChatTurn("assistant", "네")], context
        )
        self.assertEqual(answer.summary, "요약입니다.")
        self.assertEqual(answer.related_rules, ("DA-11",))
        self.assertEqual(answer.key_points, (AnswerPoint("기준", (1,)),))
        self.assertEqual(answer.checklist[0].text, "팝업을 다시 띄우지 마세요")
        request = calls[0]
        self.assertEqual(request["model"], "test-model")
        self.assertEqual(request["text"]["format"]["schema"], ANSWER_SCHEMA)
        self.assertTrue(request["text"]["format"]["strict"])
        self.assertIn("프론트엔드 개발자", request["instructions"])
        self.assertIn("③ 잘못된 계층구조=DA-03", request["instructions"])
        self.assertEqual([m["role"] for m in request["input"]], ["user", "assistant", "user"])
        self.assertIn("[1]", request["input"][-1]["content"])


class HybridRetrieverTest(unittest.TestCase):
    def test_embeds_corpus_once_and_fuses_with_lexical_ranking(self):
        chunks = load_chunks()
        target = next(i for i, c in enumerate(chunks) if "감각조작" in c.section and "압박형" in c.section)
        calls = []

        def embed(model, input):
            calls.append(len(input))
            if len(input) == len(chunks):
                vectors = [[1.0 if i == target else 0.0, 0.1] for i in range(len(chunks))]
            else:
                vectors = [[1.0, 0.0]]
            return SimpleNamespace(data=[SimpleNamespace(embedding=v) for v in vectors])

        client = SimpleNamespace(embeddings=SimpleNamespace(create=embed))
        retriever = HybridRetriever(chunks, "embed-model", client)
        first = retriever.search("선택 약관이 파란색으로 깜빡거리는 화면", 3)
        retriever.search("감각조작", 3)
        self.assertEqual(first[0].chunk.id, chunks[target].id)
        self.assertEqual(calls, [len(chunks), 1, 1])


if __name__ == "__main__":
    unittest.main()

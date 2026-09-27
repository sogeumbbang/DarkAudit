import unittest
from types import SimpleNamespace

from ai.config import AISettings
from ai.rag.chatbot import (
    NOT_FOUND_ANSWER,
    ChatTurn,
    DarkPatternChatbot,
    ExtractiveAnswerGenerator,
    OpenAIAnswerGenerator,
    create_chatbot,
)
from ai.rag.corpus import load_chunks
from ai.rag.retriever import HybridRetriever, LexicalRetriever


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


class ChatbotTest(unittest.TestCase):
    def test_fake_chatbot_cites_retrieved_sources(self):
        chatbot = create_chatbot(AISettings("fake", None))
        result = chatbot.ask("잘못된 계층구조 예시 알려줘")
        self.assertIn("[1]", result.answer)
        self.assertTrue(result.sources)
        self.assertEqual(result.sources[0].index, 1)
        self.assertIn("잘못된 계층구조", result.sources[0].section)

    def test_only_sources_cited_in_the_answer_are_returned(self):
        class CitingGenerator:
            def __init__(self, answer):
                self.answer = answer

            def generate(self, *args):
                return self.answer

        retriever = LexicalRetriever(load_chunks())
        cited = DarkPatternChatbot(retriever, CitingGenerator("답 [2] 그리고 [3]")).ask("반복간섭")
        self.assertEqual([source.index for source in cited.sources], [2, 3])
        uncited = DarkPatternChatbot(retriever, CitingGenerator("범위 밖입니다.")).ask("반복간섭")
        self.assertEqual(uncited.sources, ())

    def test_unrelated_question_gets_not_found_without_calling_generator(self):
        class FailingGenerator:
            def generate(self, *args):
                raise AssertionError("generator must not run without context")

        chatbot = DarkPatternChatbot(LexicalRetriever(load_chunks()), FailingGenerator())
        self.assertEqual(chatbot.ask("오늘 날씨 어때").answer, NOT_FOUND_ANSWER)

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

    def test_openai_generator_sends_context_history_and_grounding_rules(self):
        calls = []
        client = SimpleNamespace(responses=SimpleNamespace(
            create=lambda **kwargs: calls.append(kwargs) or SimpleNamespace(output_text="답변 [1]")
        ))
        context = LexicalRetriever(load_chunks()).search("반복간섭", 2)
        answer = OpenAIAnswerGenerator("test-model", client).generate(
            "반복간섭이 뭐야?", [ChatTurn("user", "안녕"), ChatTurn("assistant", "네")], context
        )
        self.assertEqual(answer, "답변 [1]")
        request = calls[0]
        self.assertEqual(request["model"], "test-model")
        self.assertIn("근거", request["instructions"])
        self.assertEqual([m["role"] for m in request["input"]], ["user", "assistant", "user"])
        self.assertIn("[1]", request["input"][-1]["content"])
        self.assertIn("반복간섭이 뭐야?", request["input"][-1]["content"])


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

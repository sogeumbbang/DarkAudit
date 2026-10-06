"""Optional real Ragas calculations with only generation/embedding calls stubbed."""
import asyncio
import importlib.util
import unittest
from unittest.mock import AsyncMock, patch

from ai.evaluation.rag import create_metrics, evaluate_rag


@unittest.skipUnless(importlib.util.find_spec("ragas"), "Install requirements-eval.txt for Ragas integration")
class RagasIntegrationTest(unittest.TestCase):
    def test_collections_factory_and_all_four_actual_metric_calculations(self):
        async def run():
            from openai import AsyncOpenAI

            # No request reaches this client: all paid boundaries below are mocked.
            client = AsyncOpenAI(api_key="unused-test-key")
            metrics, returned_client = create_metrics("test-judge", "test-embedding", client=client)
            self.assertIs(client, returned_client)
            llm = metrics["faithfulness"].llm
            embeddings = metrics["response_relevancy"].embeddings
            outputs = {
                "StatementGeneratorOutput": {"statements": ["선택 동의는 기본 해제한다."]},
                "NLIStatementOutput": {"statements": [{"statement": "선택 동의는 기본 해제한다.",
                                                       "reason": "근거 일치", "verdict": 1}]},
                "AnswerRelevanceOutput": {"question": "선택 동의 기본값?", "noncommittal": 0},
                "ContextPrecisionOutput": {"reason": "관련 근거", "verdict": 1},
                "ContextRecallOutput": {"classifications": [{"statement": "선택 동의는 기본 해제한다.",
                                                             "reason": "근거 일치", "attributed": 1}]},
            }

            async def generate(prompt, response_model, **kwargs):
                return response_model(**outputs[response_model.__name__])

            row = {"id": "q", "user_input": "선택 동의 기본값?", "response": "선택 동의는 기본 해제한다.",
                   "retrieved_contexts": ["선택 동의는 기본 해제한다."], "reference": "선택 동의는 기본 해제한다."}
            try:
                with patch.object(llm, "agenerate", side_effect=generate), \
                     patch.object(embeddings, "aembed_text", new=AsyncMock(return_value=[1.0, 0.0])), \
                     patch.object(embeddings, "aembed_texts", new=AsyncMock(return_value=[[1.0, 0.0]] * 3)):
                    report = await evaluate_rag([row], metrics)
                self.assertEqual(report["coverage"], 1, report["per_case"])
                for metric in report["metrics"].values():
                    self.assertAlmostEqual(metric["mean"], 1.0)
            finally:
                await client.close()

        with patch.dict("os.environ", {"RAGAS_DO_NOT_TRACK": "true"}):
            asyncio.run(run())

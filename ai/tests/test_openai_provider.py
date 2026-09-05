import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from ai.providers.openai_provider import OpenAIResponsesProvider, _responses_schema
from ai.schemas.audit_schema import AuditScreen, LLMAuditRequest


class FakeResponses:
    def __init__(self): self.kwargs = None
    def create(self, **kwargs):
        self.kwargs = kwargs
        return SimpleNamespace(output_text='{"ok": true}')


class RejectsTemperature:
    """temperature 를 받으면 실패하는 모델을 흉내낸다."""

    def __init__(self):
        self.kwargs = None
        self.attempts = 0

    def create(self, **kwargs):
        self.attempts += 1
        if "temperature" in kwargs:
            raise RuntimeError("Unsupported parameter: 'temperature' is not supported with this model.")
        self.kwargs = kwargs
        return SimpleNamespace(output_text='{"ok": true}')


class OpenAIProviderTest(unittest.TestCase):
    def test_removes_unsupported_conditional_schema_keywords(self):
        schema = {
            "type": "object",
            "properties": {"kind": {"type": "string"}},
            "allOf": [{"if": {"properties": {}}, "then": {"required": ["kind"]}}],
        }
        normalized = _responses_schema(schema)
        self.assertNotIn("allOf", normalized)
        self.assertEqual(normalized["properties"], schema["properties"])

    def test_adds_type_to_const_only_schema(self):
        self.assertEqual(
            _responses_schema({"const": "1.1"}),
            {"const": "1.1", "type": "string"},
        )

    def test_builds_responses_api_image_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            responses = FakeResponses()
            client = SimpleNamespace(responses=responses)
            request = LLMAuditRequest("audit", (AuditScreen("screen_01", "가입", image),))
            result = OpenAIResponsesProvider("test-model", client).analyze(
                request, "system", "audit", [], {"type": "object"},
                [{"rule_id": "DA-04", "measurements": {"checked": True}}],
            )
            self.assertEqual(result, {"ok": True})
            self.assertEqual(responses.kwargs["model"], "test-model")
            content = responses.kwargs["input"][0]["content"]
            self.assertTrue(any(item["type"] == "input_image" and item["image_url"].startswith("data:image/png;base64,") for item in content))
            self.assertTrue(any("audit_id=audit" in item.get("text", "") for item in content))
            self.assertTrue(any('"checked": true' in item.get("text", "") for item in content))
            candidate_text = next(
                item["text"] for item in content
                if item.get("text", "").startswith("Deterministic Candidates")
            )
            self.assertIn("exactly one KEEP or REJECT", candidate_text)
            self.assertIn("Never copy a candidate into semantic_findings", candidate_text)
            self.assertIn("semantic-only checks", candidate_text)
            self.assertIn("Do not calculate final severity", candidate_text)
            self.assertTrue(responses.kwargs["text"]["format"]["strict"])
            # 회차 간 결과가 흔들리면 Before/After 비교를 신뢰할 수 없다.
            self.assertEqual(responses.kwargs["temperature"], 0)

    def test_retries_without_temperature_when_model_rejects_it(self):
        """reasoning 계열 모델은 temperature 를 거부한다. 그 때문에 분석이
        실패하면 안 되고, 한 번 확인한 뒤로는 다시 보내지도 않아야 한다."""
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")
            responses = RejectsTemperature()
            provider = OpenAIResponsesProvider("reasoning-model", SimpleNamespace(responses=responses))
            request = LLMAuditRequest("audit", (AuditScreen("screen_01", "가입", image),))

            result = provider.analyze(request, "system", "audit", [], {"type": "object"})

            self.assertEqual(result, {"ok": True})
            self.assertEqual(responses.attempts, 2)
            self.assertNotIn("temperature", responses.kwargs)

            provider.analyze(request, "system", "audit", [], {"type": "object"})
            self.assertEqual(responses.attempts, 3)  # 재시도 없이 한 번에 성공

    def test_bbox_grounding_schema_requests_only_a_candidate_id(self):
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "marked.png"
            image.write_bytes(b"png")
            responses = FakeResponses()
            provider = OpenAIResponsesProvider(
                "test-model", SimpleNamespace(responses=responses)
            )

            provider.select_bbox_candidate(
                image,
                "안심케어 플러스",
                [{"candidate_id": "C1", "sources": ["edge", "contrast"]}],
            )

            schema = responses.kwargs["text"]["format"]["schema"]
            self.assertEqual(schema["properties"]["rule_id"]["const"], "DA-04")
            self.assertEqual(
                schema["properties"]["selected_candidate_id"]["enum"],
                ["C1", "NONE"],
            )
            prompt = responses.kwargs["input"][0]["content"][0]["text"]
            self.assertNotIn('"bbox"', prompt)

    def test_other_errors_are_not_swallowed(self):
        """인증 실패 같은 오류까지 temperature 문제로 오인해 재시도하면 안 된다."""
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "screen.png"
            image.write_bytes(b"png")

            class Failing:
                def create(self, **kwargs):
                    raise RuntimeError("invalid api key")

            provider = OpenAIResponsesProvider("m", SimpleNamespace(responses=Failing()))
            request = LLMAuditRequest("audit", (AuditScreen("screen_01", "가입", image),))
            with self.assertRaises(RuntimeError):
                provider.analyze(request, "system", "audit", [], {"type": "object"})


if __name__ == "__main__": unittest.main()

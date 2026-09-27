from unittest.mock import patch

from backend.api import chat
from backend.tests.support import IsolatedApiTestCase


class ChatApiTest(IsolatedApiTestCase):
    def setUp(self):
        super().setUp()
        chat.get_chatbot.cache_clear()
        self.addCleanup(chat.get_chatbot.cache_clear)

    def test_answers_with_sources_from_the_guideline(self):
        response = self.client.post("/api/v1/chat", json={
            "message": "특정옵션 사전선택 예시 알려줘",
            "history": [{"role": "user", "content": "안녕"}, {"role": "assistant", "content": "네"}],
        })
        self.assertEqual(response.status_code, 200, response.text)
        body = response.json()
        self.assertIn("[1]", body["answer"])
        self.assertIn("특정옵션의 사전선택", body["sources"][0]["section"])
        self.assertEqual(set(body["sources"][0]), {"index", "title", "section", "sourceFile", "excerpt"})
        structured = body["structured"]
        self.assertEqual(set(structured), {"inScope", "summary", "summaryCitations", "relatedRules",
                                           "keyPoints", "checklist"})
        self.assertTrue(structured["inScope"])
        self.assertIn({"ruleId": "DA-04", "name": "특정옵션의 사전선택"}, structured["relatedRules"])

    def test_rejects_invalid_requests(self):
        for payload in ({}, {"message": ""}, {"message": "a" * 1001},
                        {"message": "q", "history": [{"role": "system", "content": "x"}]}):
            with self.subTest(payload=payload):
                self.assertEqual(self.client.post("/api/v1/chat", json=payload).status_code, 422)
        self.assertEqual(self.client.post("/api/v1/chat", json={"message": "   "}).status_code, 422)

    def test_reports_configuration_and_generation_failures(self):
        with patch.dict("os.environ", {"DARKAUDIT_PROVIDER": "openai", "DARKAUDIT_MODEL": "",
                                       "DARKAUDIT_CHAT_MODEL": ""}):
            self.assertEqual(self.client.post("/api/v1/chat", json={"message": "반복간섭"}).status_code, 503)
        chat.get_chatbot.cache_clear()
        with patch.object(chat.get_chatbot(), "ask", side_effect=RuntimeError("boom")):
            self.assertEqual(self.client.post("/api/v1/chat", json={"message": "반복간섭"}).status_code, 502)

    def test_can_be_disabled_by_environment(self):
        for value in ("false", "0", "off"):
            with self.subTest(value=value), patch.dict("os.environ", {"DARKAUDIT_CHATBOT_ENABLED": value}):
                response = self.client.post("/api/v1/chat", json={"message": "반복간섭"})
                self.assertEqual(response.status_code, 404)
        with patch.dict("os.environ", {"DARKAUDIT_CHATBOT_ENABLED": "true"}):
            self.assertEqual(self.client.post("/api/v1/chat", json={"message": "반복간섭"}).status_code, 200)

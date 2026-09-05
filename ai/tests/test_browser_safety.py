import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from ai.browser.models import BrowserAction, BrowserActionType
from ai.browser.playwright_driver import (
    PlaywrightBrowserSession,
    _looks_like_unstyled_document,
)
from ai.browser.safety import (
    ActionSafetyPolicy,
    UnsafeActionError,
    UnsafeUrlError,
    UrlSafetyPolicy,
)


class UrlSafetyPolicyTest(unittest.TestCase):
    def test_accepts_public_http_url(self):
        policy = UrlSafetyPolicy(resolver=lambda _: ["93.184.216.34"])
        self.assertEqual(policy.validate("https://example.com/product"), "https://example.com/product")

    def test_blocks_private_address(self):
        policy = UrlSafetyPolicy(resolver=lambda _: ["127.0.0.1"])
        with self.assertRaises(UnsafeUrlError):
            policy.validate("http://localhost:8000")

    def test_blocks_cross_origin_navigation(self):
        policy = UrlSafetyPolicy(resolver=lambda _: ["93.184.216.34"])
        with self.assertRaises(UnsafeUrlError):
            policy.validate_same_origin("https://other.example/path", "https://example.com")

    def test_private_subresource_is_blocked_without_failing_public_page(self):
        main_frame = object()
        session = object.__new__(PlaywrightBrowserSession)
        session.url_policy = UrlSafetyPolicy(resolver=lambda _: ["127.0.0.1"])
        session._page = SimpleNamespace(main_frame=main_frame)
        session._origin_url = "https://example.com"
        session._blocked_reason = None
        session._validated_hosts = set()
        route = SimpleNamespace(abort=Mock(), continue_=Mock())
        request = SimpleNamespace(
            url="http://127.0.0.1:12345/security-agent",
            frame=main_frame,
            is_navigation_request=lambda: False,
        )

        session._route_request(route, request)

        route.abort.assert_called_once_with("blockedbyclient")
        route.continue_.assert_not_called()
        self.assertIsNone(session._blocked_reason)

    def test_private_main_navigation_still_fails_session(self):
        main_frame = object()
        session = object.__new__(PlaywrightBrowserSession)
        session.url_policy = UrlSafetyPolicy(resolver=lambda _: ["127.0.0.1"])
        session._page = SimpleNamespace(main_frame=main_frame)
        session._origin_url = "https://example.com"
        session._blocked_reason = None
        session._validated_hosts = set()
        route = SimpleNamespace(abort=Mock(), continue_=Mock())
        request = SimpleNamespace(
            url="http://127.0.0.1:12345/redirect",
            frame=main_frame,
            is_navigation_request=lambda: True,
        )

        session._route_request(route, request)

        route.abort.assert_called_once_with("blockedbyclient")
        self.assertIn("127.0.0.1", session._blocked_reason)


class ActionSafetyPolicyTest(unittest.TestCase):
    def test_allows_reversible_scroll(self):
        ActionSafetyPolicy().validate(
            BrowserAction(BrowserActionType.SCROLL, x=100, y=100, scroll_y=600),
            viewport_width=390,
            viewport_height=844,
        )

    def test_blocks_typing(self):
        with self.assertRaises(UnsafeActionError):
            ActionSafetyPolicy().validate(
                BrowserAction(BrowserActionType.TYPE, text="secret"),
                viewport_width=390,
                viewport_height=844,
            )

    def test_blocks_consequential_click(self):
        with self.assertRaises(UnsafeActionError):
            ActionSafetyPolicy().validate(
                BrowserAction(BrowserActionType.CLICK, x=10, y=10),
                viewport_width=390,
                viewport_height=844,
                target={"tag": "button", "text": "결제하기"},
            )


class RenderQualityTest(unittest.TestCase):
    def test_rejects_large_document_using_browser_default_styles(self):
        self.assertTrue(
            _looks_like_unstyled_document(
                {
                    "stylesheet_count": 0,
                    "linked_stylesheet_count": 0,
                    "style_element_count": 0,
                    "visible_link_count": 28,
                    "default_link_count": 26,
                    "body_font_family": '"Times New Roman"',
                }
            )
        )

    def test_accepts_visually_styled_document(self):
        self.assertFalse(
            _looks_like_unstyled_document(
                {
                    "stylesheet_count": 1,
                    "linked_stylesheet_count": 1,
                    "style_element_count": 0,
                    "visible_link_count": 28,
                    "default_link_count": 0,
                    "body_font_family": "Arial, sans-serif",
                }
            )
        )

    def test_rejects_default_render_even_when_stylesheet_link_exists(self):
        self.assertTrue(
            _looks_like_unstyled_document(
                {
                    "stylesheet_count": 1,
                    "linked_stylesheet_count": 1,
                    "style_element_count": 0,
                    "visible_link_count": 28,
                    "default_link_count": 26,
                    "body_font_family": '"Times New Roman"',
                }
            )
        )

    def test_accepts_small_intentionally_plain_document(self):
        self.assertFalse(
            _looks_like_unstyled_document(
                {
                    "stylesheet_count": 0,
                    "linked_stylesheet_count": 0,
                    "style_element_count": 0,
                    "visible_link_count": 3,
                    "default_link_count": 3,
                    "body_font_family": '"Times New Roman"',
                }
            )
        )

if __name__ == "__main__":
    unittest.main()

"""Playwright-backed browser session with network isolation checks."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from types import TracebackType
from typing import Any
from urllib.parse import urlsplit

from .models import BrowserAction, BrowserActionType, CaptureArtifact
from .profiles import DeviceProfile
from .safety import UnsafeUrlError, UrlSafetyPolicy


# backend.app.rule_engine.core.load_flow() 가 기대하는 element 스키마.
# data/generator/extract_ui.py 의 색상/대비 유틸을 그대로 쓰되, 요소 선택과
# element_type 판정은 임의 사이트에서 동작하도록 태그/role/type 기반으로 바꿨다.
_RULE_ENGINE_EXTRACT_JS = r"""
() => {
  const rgb = (s) => {
    const m = (s || '').match(/[\d.]+/g);
    if (!m) return null;
    return { r: +m[0], g: +m[1], b: +m[2], a: m.length > 3 ? +m[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = rgb(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.05) return c;
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  };
  const contrast = (fg, bg) => {
    if (!fg || !bg) return null;
    const a = lum(fg), b = lum(bg);
    return +(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05))).toFixed(2);
  };

  const daId = (el) => {
    const tag = el.tagName.toLowerCase();
    const cls = (el.className || '').toString().trim().split(/\s+/).filter(Boolean).sort().join('.');
    const txt = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    const path = [];
    let n = el;
    while (n && n !== document.body && path.length < 4) {
      path.push(n.tagName.toLowerCase()); n = n.parentElement;
    }
    const raw = [path.reverse().join('>'), cls, txt].join('|');
    let h = 0;
    for (let i = 0; i < raw.length; i++) { h = (h * 31 + raw.charCodeAt(i)) | 0; }
    return tag + '-' + (h >>> 0).toString(36);
  };

  // 금액/이율 표기가 섞인 텍스트는 price 로, 그 외는 태그/role 기반으로 판정한다.
  const MONEY_OR_RATE = /[\d][\d,]*\s*원|[\d.]+\s*%/;
  const typeOf = (el, text) => {
    const tag = el.tagName.toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && (type === 'checkbox' || type === 'radio')) return 'checkbox';
    if (role === 'checkbox' || role === 'radio') return 'checkbox';
    if (tag === 'button' || role === 'button' || (tag === 'input' && (type === 'button' || type === 'submit'))) return 'button';
    if (tag === 'a' || role === 'link') return 'link';
    if (MONEY_OR_RATE.test(text || '')) return 'price';
    return 'text';
  };

  // 같은 텍스트를 감싼 중첩 래퍼가 중복 요소로 잡히지 않도록,
  // 자기 자신의 직속 텍스트 노드가 있거나 상호작용 요소인 경우만 취급한다.
  const hasOwnText = (el) => Array.from(el.childNodes).some(
    (n) => n.nodeType === 3 && n.textContent.trim().length > 0
  );

  const W = window.innerWidth, H = window.innerHeight;
  const SEL = 'button, a, input, select, textarea, label, '
            + '[role="button"], [role="link"], [role="checkbox"], [role="radio"], '
            + 'h1, h2, h3, h4, p, li, span';
  const INTERACTIVE = new Set(['button', 'checkbox', 'link']);

  const out = [];
  const seen = new Set();
  document.querySelectorAll(SEL).forEach((el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.bottom < 0 || r.right < 0 || r.top > H || r.left > W) return;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') return;

    const text = (el.innerText || el.value || el.textContent || '').trim().replace(/\s+/g, ' ');
    const elementType = typeOf(el, text);
    if (elementType === 'text' && !hasOwnText(el)) return;
    if (elementType === 'text' && !text) return;

    const id = daId(el);
    if (seen.has(id)) return;
    seen.add(id);

    const fg = rgb(cs.color);
    const bg = bgOf(el);
    const animated = cs.animationName !== 'none' && cs.animationName !== '';

    out.push({
      element_id: id,
      element_type: elementType,
      text: text.slice(0, 200) || null,
      bbox: [ +(r.x / W).toFixed(4), +(r.y / H).toFixed(4),
              +(r.width / W).toFixed(4), +(r.height / H).toFixed(4) ],
      state: {
        checked: 'checked' in el ? Boolean(el.checked) : null,
        disabled: 'disabled' in el ? Boolean(el.disabled) : null,
      },
      computed_style: {
        font_size: parseFloat(cs.fontSize) || null,
        contrast_ratio: contrast(fg, bg),
        area_ratio: +((r.width * r.height) / (W * H)).toFixed(5),
        animated: animated,
      },
    });
  });

  return out.slice(0, 250);
}
"""


_RENDER_QUALITY_JS = r"""
() => {
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0
      && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const links = Array.from(document.querySelectorAll('a')).filter(visible);
  const defaultLinks = links.filter((element) => {
    const style = getComputedStyle(element);
    return (style.color === 'rgb(0, 0, 238)' || style.color === 'rgb(85, 26, 139)')
      && style.textDecorationLine.includes('underline');
  });
  const bodyStyle = document.body ? getComputedStyle(document.body) : null;
  return {
    stylesheet_count: document.styleSheets.length,
    linked_stylesheet_count: document.querySelectorAll('link[rel~="stylesheet"]').length,
    style_element_count: document.querySelectorAll('style').length,
    visible_link_count: links.length,
    default_link_count: defaultLinks.length,
    body_font_family: bodyStyle ? bodyStyle.fontFamily : '',
  };
}
"""


class UnrenderedPageError(RuntimeError):
    """Raised when a URL produced an obviously unstyled document."""


def _looks_like_unstyled_document(metrics: dict[str, Any]) -> bool:
    """Detect high-confidence browser-default HTML without rejecting small plain pages."""
    link_count = int(metrics.get("visible_link_count") or 0)
    default_link_count = int(metrics.get("default_link_count") or 0)
    font_family = str(metrics.get("body_font_family") or "").lower()

    if link_count < 10 or default_link_count / link_count < 0.8:
        return False
    return "times new roman" in font_family or font_family.strip() in {"serif", "times"}


def _safe_segment(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip(".-")
    if not cleaned:
        raise ValueError("Artifact path segment cannot be empty")
    return cleaned[:80]


class PlaywrightSessionFactory:
    def __init__(
        self,
        output_root: str | Path,
        *,
        url_policy: UrlSafetyPolicy | None = None,
        headless: bool = True,
        navigation_timeout_ms: int = 30_000,
        settle_time_ms: int = 750,
    ) -> None:
        self.output_root = Path(output_root)
        self.url_policy = url_policy or UrlSafetyPolicy()
        self.headless = headless
        self.navigation_timeout_ms = navigation_timeout_ms
        self.settle_time_ms = settle_time_ms

    def __call__(self, audit_id: str, profile: DeviceProfile) -> "PlaywrightBrowserSession":
        target = self.output_root / _safe_segment(audit_id) / _safe_segment(profile.name)
        return PlaywrightBrowserSession(
            profile,
            target,
            url_policy=self.url_policy,
            headless=self.headless,
            navigation_timeout_ms=self.navigation_timeout_ms,
            settle_time_ms=self.settle_time_ms,
        )


class PlaywrightBrowserSession:
    def __init__(
        self,
        profile: DeviceProfile,
        output_dir: Path,
        *,
        url_policy: UrlSafetyPolicy,
        headless: bool,
        navigation_timeout_ms: int,
        settle_time_ms: int,
    ) -> None:
        self.profile = profile
        self.output_dir = output_dir
        self.url_policy = url_policy
        self.headless = headless
        self.navigation_timeout_ms = navigation_timeout_ms
        self.settle_time_ms = settle_time_ms
        self._manager: Any = None
        self._browser: Any = None
        self._context: Any = None
        self._page: Any = None
        self._origin_url: str | None = None
        self._artifact_index = 0
        self._blocked_reason: str | None = None
        self._validated_hosts: set[str] = set()

    def __enter__(self) -> "PlaywrightBrowserSession":
        try:
            from playwright.sync_api import sync_playwright
        except ImportError as exc:
            raise RuntimeError(
                "Playwright is not installed. Run: pip install playwright && playwright install chromium"
            ) from exc

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self._manager = sync_playwright().start()
        self._browser = self._manager.chromium.launch(
            headless=self.headless,
            args=["--disable-extensions", "--disable-dev-shm-usage"],
        )
        options: dict[str, Any] = {}
        if self.profile.playwright_device:
            options.update(self._manager.devices.get(self.profile.playwright_device, {}))
        options.update(
            {
                "viewport": {
                    "width": self.profile.viewport_width,
                    "height": self.profile.viewport_height,
                },
                "device_scale_factor": self.profile.device_scale_factor,
                "is_mobile": self.profile.is_mobile,
                "has_touch": self.profile.has_touch,
                "locale": "ko-KR",
                "timezone_id": "Asia/Seoul",
                "accept_downloads": False,
            }
        )
        self._context = self._browser.new_context(**options)
        self._page = self._context.new_page()
        self._page.set_default_timeout(10_000)
        self._page.route("**/*", self._route_request)
        self._context.on("page", lambda popup: popup.close() if popup != self._page else None)
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        if self._context is not None:
            self._context.close()
        if self._browser is not None:
            self._browser.close()
        if self._manager is not None:
            self._manager.stop()

    def start(self, url: str) -> CaptureArtifact:
        self.url_policy.validate(url)
        # Permit the initial public redirect chain (for example http -> https),
        # then lock smart exploration to the final origin.
        self._origin_url = None
        try:
            self._page.goto(url, wait_until="domcontentloaded", timeout=self.navigation_timeout_ms)
        except Exception as exc:
            if self._blocked_reason:
                raise UnsafeUrlError(self._blocked_reason) from exc
            raise
        self._settle()
        self.url_policy.validate(self._page.url)
        self._origin_url = self._page.url
        self._validate_current_url()
        return self.capture("initial viewport")

    def capture(
        self,
        flow_step: str,
        *,
        full_page: bool = False,
        action: BrowserAction | None = None,
    ) -> CaptureArtifact:
        self._validate_current_url()
        self._assert_render_quality()
        index = self._artifact_index
        self._artifact_index += 1
        slug = _safe_segment(flow_step.lower().replace(" ", "-"))
        path = self.output_dir / f"{index:02d}-{slug}.png"
        image = self._page.screenshot(
            path=str(path),
            full_page=full_page,
            animations="disabled",
            caret="hide",
            scale="css",
        )
        visible_text = self._visible_text()
        elements = tuple(self._interactive_elements())
        dom_elements = tuple(self._rule_engine_elements())
        return CaptureArtifact(
            screen_id=f"{self.profile.name}_{index:02d}",
            flow_step=f"{self.profile.name}: {flow_step}",
            profile=self.profile.name,
            url=self._page.url,
            title=self._page.title(),
            image_path=path,
            viewport_width=self.profile.viewport_width,
            viewport_height=self.profile.viewport_height,
            full_page=full_page,
            action=action,
            visible_text=visible_text,
            interactive_elements=elements,
            dom_elements=dom_elements,
            fingerprint=hashlib.sha256(image).hexdigest(),
        )

    def execute(self, action: BrowserAction) -> None:
        match action.type:
            case BrowserActionType.CLICK:
                self._page.mouse.click(action.x, action.y, button=action.button)
            case BrowserActionType.SCROLL:
                self._page.mouse.move(action.x, action.y)
                self._page.mouse.wheel(action.scroll_x, action.scroll_y)
            case BrowserActionType.WAIT:
                self._page.wait_for_timeout(1_000)
            case BrowserActionType.KEYPRESS:
                for key in action.keys:
                    self._page.keyboard.press(_normalize_key(key))
            case BrowserActionType.MOVE:
                self._page.mouse.move(action.x, action.y)
            case BrowserActionType.SCREENSHOT:
                return
            case _:
                raise ValueError(f"Unsupported action: {action.type.value}")
        self._settle()
        self._validate_current_url()

    def inspect_target(self, action: BrowserAction) -> dict[str, Any] | None:
        if action.x is None or action.y is None:
            return None
        return self._page.evaluate(
            """
            ({x, y}) => {
              const hit = document.elementFromPoint(x, y);
              if (!hit) return null;
              const element = hit.closest('button,a,input,select,textarea,[role="button"],[role="link"]') || hit;
              return {
                tag: element.tagName.toLowerCase(),
                type: element.getAttribute('type') || '',
                text: (element.innerText || element.textContent || '').trim().slice(0, 300),
                ariaLabel: element.getAttribute('aria-label') || '',
                title: element.getAttribute('title') || '',
                value: element.getAttribute('value') || '',
                href: element.href || ''
              };
            }
            """,
            {"x": action.x, "y": action.y},
        )

    def _route_request(self, route: Any, request: Any) -> None:
        parsed = urlsplit(request.url)
        is_main_navigation = (
            request.is_navigation_request()
            and request.frame == self._page.main_frame
        )
        if parsed.scheme not in {"http", "https"}:
            if parsed.scheme in {"data", "blob", "about"}:
                route.continue_()
            else:
                route.abort("blockedbyclient")
            return
        try:
            hostname = parsed.hostname or ""
            if hostname not in self._validated_hosts:
                self.url_policy.validate(request.url)
                self._validated_hosts.add(hostname)
            if (
                self._origin_url
                and is_main_navigation
            ):
                self.url_policy.validate_same_origin(request.url, self._origin_url)
        except UnsafeUrlError as exc:
            # Pages may probe localhost for native security software. Keep the
            # private request blocked, but do not fail an otherwise public audit.
            # A blocked main-frame navigation still terminates the session.
            if is_main_navigation:
                self._blocked_reason = str(exc)
            route.abort("blockedbyclient")
            return
        route.continue_()

    def _validate_current_url(self) -> None:
        if self._blocked_reason:
            raise UnsafeUrlError(self._blocked_reason)
        if self._origin_url:
            self.url_policy.validate_same_origin(self._page.url, self._origin_url)

    def _settle(self) -> None:
        try:
            self._page.wait_for_load_state("load", timeout=8_000)
        except Exception:
            pass
        self._page.wait_for_timeout(self.settle_time_ms)

    def _assert_render_quality(self) -> None:
        try:
            metrics = self._page.evaluate(_RENDER_QUALITY_JS)
        except Exception:
            return
        if _looks_like_unstyled_document(metrics):
            raise UnrenderedPageError(
                "페이지가 스타일시트 없이 기본 HTML로 열렸습니다. "
                "사이트 내부 템플릿 주소가 아닌 실제 홈 또는 상품 페이지 URL을 입력해 주세요."
            )

    def _visible_text(self) -> str:
        try:
            return self._page.locator("body").inner_text(timeout=3_000)[:12_000]
        except Exception:
            return ""

    def _interactive_elements(self) -> list[dict[str, Any]]:
        try:
            return self._page.evaluate(
                """
                () => Array.from(document.querySelectorAll(
                  'a,button,input,select,textarea,[role="button"],[role="link"],[role="checkbox"],[role="radio"]'
                )).filter((element) => {
                  const rect = element.getBoundingClientRect();
                  const style = getComputedStyle(element);
                  return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
                }).slice(0, 100).map((element) => {
                  const rect = element.getBoundingClientRect();
                  return {
                    tag: element.tagName.toLowerCase(),
                    role: element.getAttribute('role') || '',
                    type: element.getAttribute('type') || '',
                    text: (element.innerText || element.value || element.textContent || '').trim().slice(0, 300),
                    ariaLabel: element.getAttribute('aria-label') || '',
                    checked: 'checked' in element ? Boolean(element.checked) : null,
                    disabled: 'disabled' in element ? Boolean(element.disabled) : null,
                    href: element.href || '',
                    box: {x: rect.x, y: rect.y, width: rect.width, height: rect.height}
                  };
                })
                """
            )
        except Exception:
            return []

    def _rule_engine_elements(self) -> list[dict[str, Any]]:
        """DOM 을 backend.app.rule_engine 이 소비하는 Element 형태로 추출한다.

        data/generator/extract_ui.py 는 합성 데이터셋 전용 클래스명(.btn/.box 등)에
        기대는 반면, 여기서는 임의의 실제 페이지를 다뤄야 하므로 태그/role/type
        기반의 일반화된 규칙으로 element_type 을 판정한다. contrast/area 계산
        로직 자체는 extract_ui.py 와 동일하다.
        """
        try:
            return self._page.evaluate(_RULE_ENGINE_EXTRACT_JS)
        except Exception:
            return []


def _normalize_key(key: str) -> str:
    mapping = {
        "ESC": "Escape",
        "ESCAPE": "Escape",
        "TAB": "Tab",
        "ARROWUP": "ArrowUp",
        "ARROWDOWN": "ArrowDown",
        "PAGEUP": "PageUp",
        "PAGEDOWN": "PageDown",
    }
    return mapping.get(key.upper(), key)

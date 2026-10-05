"""Serve the bundled local demo in the capture browser without private-network access."""
from urllib.parse import parse_qs, urlsplit

from ai.browser.safety import UnsafeUrlError, UrlSafetyPolicy
from .demo_inputs import WEB_DIR

ASSETS = {"index.html", "style.css", "scenarios.js", "variants.js", "demo.js"}


class BundledDemoPolicy(UrlSafetyPolicy):
    def __init__(self, seed_url: str, scenario: str, variant: str):
        super().__init__()
        self.seed_url = seed_url
        self.scenario = scenario
        self.variant = variant
        self.assets = {f"/demo/web/{name}": WEB_DIR / name for name in ASSETS}

    def validate(self, url: str) -> str:
        parsed = urlsplit(url)
        if parsed.username or parsed.password or self.origin(url) != self.origin(self.seed_url):
            raise UnsafeUrlError("내장 데모 이외의 주소로 이동할 수 없습니다.")
        if parsed.path not in self.assets:
            raise UnsafeUrlError("내장 데모 파일만 열 수 있습니다.")
        params = parse_qs(parsed.query, keep_blank_values=True)
        if parsed.path.endswith("/index.html"):
            if (set(params) != {"scenario", "variant", "step"}
                    or params.get("scenario") != [self.scenario]
                    or params.get("variant") != [self.variant]
                    or params.get("step") not in [[str(i)] for i in range(1, 7)]):
                raise UnsafeUrlError("등록된 데모의 1~6단계만 열 수 있습니다.")
        elif params:
            raise UnsafeUrlError("잘못된 데모 파일 주소입니다.")
        return url


def bundled_demo_policy(url: str, preset: dict | None, variant: str | None) -> BundledDemoPolicy | None:
    parsed = urlsplit(url)
    if (parsed.scheme != "http" or parsed.hostname not in {"localhost", "127.0.0.1", "::1"}
            or not preset or preset.get("source") != "website"
            or preset.get("scenario") not in {"pet", "travel", "credit"}
            or variant not in {"risky", "partial", "revised"}):
        return None
    policy = BundledDemoPolicy(url, preset["scenario"], variant)
    policy.validate(url)
    return policy

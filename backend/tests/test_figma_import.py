from __future__ import annotations

import base64
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# backend.api.store/main 은 모듈 싱글턴이라 DATA_DIR/DB 엔진이 "처음 import되는 시점"에
# 고정된다. 다른 테스트 파일(test_api.py)이 pytest 수집 단계에서 먼저 import 되어
# 이미 자신의 임시 폴더/DB로 초기화해뒀다면, 그 설정을 덮어쓰지 않고 그대로 공유한다
# (같은 프로세스에서 서로 다른 DATA_DIR 를 만들면 relative_to() 가 깨진다).
_already_configured = "backend.api.store" in sys.modules
_owns_temp_root = not _already_configured

if _owns_temp_root:
    _temp_root = Path(tempfile.mkdtemp(prefix="darkaudit-figma-test-"))
    os.environ["DARKAUDIT_DB_URL"] = f"sqlite:///{(_temp_root / 'test.db').as_posix()}"
os.environ["DARKAUDIT_PROVIDER"] = "fake"
os.environ["FIGMA_ACCESS_TOKEN"] = "test-token"
os.environ["FIGMA_MAX_FRAMES"] = "5"

import httpx  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from backend.api import figma_import, service  # noqa: E402

if _owns_temp_root:
    service.DATA_DIR = _temp_root
    service.UPLOAD_DIR = _temp_root / "uploads"
    service.CAPTURE_DIR = _temp_root / "captures"
else:
    _temp_root = service.DATA_DIR  # 정리는 그 파일을 소유한 테스트가 담당한다
# FIGMA_DIR 는 항상 "현재" DATA_DIR 밑에 둔다 — 다른 파일이 먼저 DATA_DIR 를 정했더라도
# public_image_path() 의 relative_to(DATA_DIR) 가 깨지지 않도록.
service.FIGMA_DIR = service.DATA_DIR / "figma"

from backend.api.figma_client import (  # noqa: E402
    FigmaClient,
    FigmaError,
    FigmaSettings,
    InvalidFigmaUrlError,
    parse_figma_url,
)
from backend.api.figma_frames import (  # noqa: E402
    collect_candidate_frames,
    select_frames,
    select_prototype_flow,
)
from backend.api.main import app  # noqa: E402

# 1x1 흰색 PNG. 실제 다운로드 없이 magic bytes/Pillow 검증을 통과시키는 용도.
_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

_TWO_FRAME_DOCUMENT = {
    "children": [
        {
            "id": "0:1",
            "type": "CANVAS",
            "children": [
                {
                    "id": "3:2",
                    "type": "FRAME",
                    "name": "01_Product_Select",
                    "visible": True,
                    "absoluteBoundingBox": {"x": 0, "y": 0, "width": 393, "height": 852},
                },
                {
                    "id": "3:5",
                    "type": "FRAME",
                    "name": "02_Confirm",
                    "visible": True,
                    "absoluteBoundingBox": {"x": 0, "y": 900, "width": 393, "height": 852},
                },
                {
                    "id": "3:9",
                    "type": "GROUP",  # 후보 타입이 아니므로 all-frames 에서는 제외되어야 한다
                    "name": "helper-group",
                    "visible": True,
                    "absoluteBoundingBox": {"x": 0, "y": 0, "width": 100, "height": 100},
                },
            ],
        }
    ]
}

_PROTOTYPE_DOCUMENT = {
    "children": [
        {
            "id": "0:1",
            "type": "CANVAS",
            "flowStartingPoints": [
                {"nodeId": "3:2", "name": "가입 Flow"},
                {"nodeId": "4:1", "name": "결제 Flow"},
            ],
            "children": [
                {
                    "id": "3:2", "type": "FRAME", "name": "가입 시작", "visible": True,
                    "absoluteBoundingBox": {"x": 0, "y": 0, "width": 393, "height": 852},
                    "children": [{
                        "id": "3:3", "type": "TEXT", "name": "다음",
                        "reactions": [{"action": {"type": "NODE", "destinationId": "3:5"}}],
                    }],
                },
                {
                    "id": "3:5", "type": "FRAME", "name": "가입 확인", "visible": True,
                    "absoluteBoundingBox": {"x": 0, "y": 900, "width": 393, "height": 852},
                    "reactions": [{"action": {"type": "NODE", "destinationId": "3:8"}}],
                },
                {
                    "id": "3:8", "type": "FRAME", "name": "가입 완료", "visible": True,
                    "absoluteBoundingBox": {"x": 0, "y": 1800, "width": 393, "height": 852},
                },
                {
                    "id": "4:1", "type": "FRAME", "name": "결제 시작", "visible": True,
                    "absoluteBoundingBox": {"x": 500, "y": 0, "width": 393, "height": 852},
                },
            ],
        }
    ]
}


class ParseFigmaUrlTest(unittest.TestCase):
    def test_extracts_file_key_and_converts_node_id(self) -> None:
        file_key, node_id = parse_figma_url(
            "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup?node-id=3-2"
        )
        self.assertEqual(file_key, "YtP0tCCij8KTBOiZXkzh9B")
        self.assertEqual(node_id, "3:2")

    def test_no_node_id_is_none(self) -> None:
        _, node_id = parse_figma_url("https://figma.com/design/abc123/Mockup")
        self.assertIsNone(node_id)

    def test_rejects_http_scheme(self) -> None:
        with self.assertRaises(InvalidFigmaUrlError):
            parse_figma_url("http://www.figma.com/design/abc123/Mockup")

    def test_rejects_disallowed_host(self) -> None:
        with self.assertRaises(InvalidFigmaUrlError):
            parse_figma_url("https://evil.example.com/design/abc123/Mockup")

    def test_rejects_malformed_file_key(self) -> None:
        with self.assertRaises(InvalidFigmaUrlError):
            parse_figma_url("https://www.figma.com/design/abc 123/Mockup")

    def test_rejects_wrong_path_shape(self) -> None:
        with self.assertRaises(InvalidFigmaUrlError):
            parse_figma_url("https://www.figma.com/community/abc123")


class FrameSelectionTest(unittest.TestCase):
    def test_collects_only_candidate_types_and_visible_sized_nodes(self) -> None:
        frames = collect_candidate_frames(_TWO_FRAME_DOCUMENT)
        self.assertEqual({f.node_id for f in frames}, {"3:2", "3:5"})

    def test_numeric_prefix_orders_by_flow_number(self) -> None:
        frames = collect_candidate_frames(_TWO_FRAME_DOCUMENT)
        ordered = select_frames(frames, target="mobile-web", max_frames=5)
        self.assertEqual([f.node_id for f in ordered], ["3:2", "3:5"])

    def test_falls_back_to_canvas_order_without_prefix(self) -> None:
        document = {
            "children": [
                {
                    "id": "0:1",
                    "type": "CANVAS",
                    "children": [
                        {
                            "id": "a", "type": "FRAME", "name": "Confirm", "visible": True,
                            "absoluteBoundingBox": {"x": 0, "y": 900, "width": 393, "height": 852},
                        },
                        {
                            "id": "b", "type": "FRAME", "name": "Select", "visible": True,
                            "absoluteBoundingBox": {"x": 0, "y": 0, "width": 393, "height": 852},
                        },
                    ],
                }
            ]
        }
        ordered = select_frames(collect_candidate_frames(document), target="mobile-web", max_frames=5)
        self.assertEqual([f.node_id for f in ordered], ["b", "a"])  # y 오름차순

    def test_invisible_and_zero_size_nodes_are_excluded(self) -> None:
        document = {
            "children": [
                {
                    "id": "0:1",
                    "type": "CANVAS",
                    "children": [
                        {
                            "id": "hidden", "type": "FRAME", "name": "01_hidden", "visible": False,
                            "absoluteBoundingBox": {"x": 0, "y": 0, "width": 393, "height": 852},
                        },
                        {
                            "id": "empty", "type": "FRAME", "name": "02_empty",
                            "absoluteBoundingBox": {"x": 0, "y": 0, "width": 0, "height": 852},
                        },
                    ],
                }
            ]
        }
        self.assertEqual(collect_candidate_frames(document), [])

    def test_max_frames_caps_selection(self) -> None:
        children = [
            {
                "id": f"n{i}", "type": "FRAME", "name": f"{i:02d}_screen", "visible": True,
                "absoluteBoundingBox": {"x": 0, "y": i * 900, "width": 393, "height": 852},
            }
            for i in range(1, 8)
        ]
        document = {"children": [{"id": "0:1", "type": "CANVAS", "children": children}]}
        ordered = select_frames(collect_candidate_frames(document), target="mobile-web", max_frames=5)
        self.assertEqual(len(ordered), 5)

    def test_mobile_width_filter_prefers_narrow_portrait_frames(self) -> None:
        document = {
            "children": [
                {
                    "id": "0:1",
                    "type": "CANVAS",
                    "children": [
                        {
                            "id": "desktop", "type": "FRAME", "name": "01_desktop", "visible": True,
                            "absoluteBoundingBox": {"x": 0, "y": 0, "width": 1440, "height": 900},
                        },
                        {
                            "id": "mobile", "type": "FRAME", "name": "02_mobile", "visible": True,
                            "absoluteBoundingBox": {"x": 0, "y": 900, "width": 393, "height": 852},
                        },
                    ],
                }
            ]
        }
        ordered = select_frames(collect_candidate_frames(document), target="mobile-web", max_frames=5)
        self.assertEqual([f.node_id for f in ordered], ["mobile"])

    def test_expands_wide_flow_container_into_outermost_mobile_frames(self) -> None:
        mobile_frames = []
        for index in range(5):
            mobile_frames.append(
                {
                    "id": f"screen-{index}",
                    "type": "FRAME",
                    "name": f"0{index + 1}_screen",
                    "absoluteBoundingBox": {
                        "x": index * 450,
                        "y": 80,
                        "width": 390,
                        "height": 844,
                    },
                    "children": [
                        {
                            "id": f"card-{index}",
                            "type": "FRAME",
                            "name": "option card",
                            "absoluteBoundingBox": {
                                "x": index * 450 + 20,
                                "y": 200,
                                "width": 340,
                                "height": 500,
                            },
                        }
                    ],
                }
            )
        document = {
            "children": [
                {
                    "id": "0:1",
                    "type": "CANVAS",
                    "children": [
                        {
                            "id": "flow",
                            "type": "SECTION",
                            "name": "Dark Pattern Mobile Flow",
                            "absoluteBoundingBox": {
                                "x": 0,
                                "y": 0,
                                "width": 2366,
                                "height": 1004,
                            },
                            "children": mobile_frames,
                        }
                    ],
                }
            ]
        }

        frames = collect_candidate_frames(document, expand_mobile_containers=True)

        self.assertEqual(
            [frame.node_id for frame in frames],
            ["screen-0", "screen-1", "screen-2", "screen-3", "screen-4"],
        )
        self.assertFalse(any(frame.node_id.startswith("card-") for frame in frames))

    def test_prototype_flow_follows_nested_reaction_destinations(self) -> None:
        frames = select_prototype_flow(
            _PROTOTYPE_DOCUMENT, flow_name="가입 Flow", max_frames=5
        )
        self.assertEqual([frame.node_id for frame in frames], ["3:2", "3:5", "3:8"])

    def test_prototype_flow_uses_first_start_when_name_is_blank(self) -> None:
        frames = select_prototype_flow(_PROTOTYPE_DOCUMENT, flow_name=None, max_frames=2)
        self.assertEqual([frame.node_id for frame in frames], ["3:2", "3:5"])

    def test_prototype_flow_reports_available_names(self) -> None:
        with self.assertRaisesRegex(ValueError, "가입 Flow"):
            select_prototype_flow(_PROTOTYPE_DOCUMENT, flow_name="없는 Flow", max_frames=5)


class FigmaClientTest(unittest.TestCase):
    def _settings(self) -> FigmaSettings:
        return FigmaSettings(access_token="test-token", max_frames=5)

    def test_get_file_returns_json(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            self.assertEqual(request.headers["X-Figma-Token"], "test-token")
            return httpx.Response(200, json={"document": {"children": []}})

        client = FigmaClient(
            self._settings(),
            client=httpx.Client(base_url="https://api.figma.com/v1", transport=httpx.MockTransport(handler)),
        )
        self.assertEqual(client.get_file("abc")["document"], {"children": []})

    def test_render_frames_returns_null_urls_as_is(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(200, json={"err": None, "images": {"1:1": "https://cdn.figma.com/x.png", "1:2": None}})

        client = FigmaClient(
            self._settings(),
            client=httpx.Client(base_url="https://api.figma.com/v1", transport=httpx.MockTransport(handler)),
        )
        images = client.render_frames("abc", ["1:1", "1:2"])
        self.assertEqual(images["1:1"], "https://cdn.figma.com/x.png")
        self.assertIsNone(images["1:2"])

    def test_retries_on_429_then_succeeds(self) -> None:
        attempts = {"count": 0}

        def handler(request: httpx.Request) -> httpx.Response:
            attempts["count"] += 1
            if attempts["count"] < 2:
                return httpx.Response(429, json={"message": "rate limited"})
            return httpx.Response(200, json={"document": {"children": []}})

        client = FigmaClient(
            self._settings(),
            client=httpx.Client(base_url="https://api.figma.com/v1", transport=httpx.MockTransport(handler)),
            sleep=lambda _seconds: None,
        )
        client.get_file("abc")
        self.assertEqual(attempts["count"], 2)

    def test_non_retryable_error_raises_immediately(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(404, json={"message": "not found"})

        client = FigmaClient(
            self._settings(),
            client=httpx.Client(base_url="https://api.figma.com/v1", transport=httpx.MockTransport(handler)),
        )
        with self.assertRaises(FigmaError) as ctx:
            client.get_file("abc")
        self.assertEqual(ctx.exception.status, 404)


class StubFigmaClient:
    """FigmaClient 대역: 네트워크 없이 file tree + PNG 다운로드를 흉내낸다."""

    document = _TWO_FRAME_DOCUMENT
    null_node_ids: set[str] = set()

    def __init__(self, *_args, **_kwargs) -> None:
        pass

    def get_file(self, file_key: str) -> dict:
        return {"document": self.document}

    def render_frames(self, file_key: str, node_ids: list[str]) -> dict[str, str | None]:
        return {nid: (None if nid in self.null_node_ids else f"https://cdn.figma.com/{nid}.png") for nid in node_ids}

    def download_render(self, url: str, destination: Path, *, max_bytes: int) -> int:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(_TINY_PNG)
        return len(_TINY_PNG)


class FigmaApiIntegrationTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client_context = TestClient(app)
        cls.client = cls.client_context.__enter__()

    @classmethod
    def tearDownClass(cls) -> None:
        cls.client_context.__exit__(None, None, None)
        if _owns_temp_root:
            shutil.rmtree(_temp_root, ignore_errors=True)

    def setUp(self) -> None:
        StubFigmaClient.document = _TWO_FRAME_DOCUMENT
        StubFigmaClient.null_node_ids = set()

    def _create_audit(self, name: str) -> str:
        return self.client.post(
            "/api/v1/audits", json={"name": name, "platform": "mobile-web"}
        ).json()["id"]

    def test_all_frames_import_persists_screens_and_manifest(self) -> None:
        audit_id = self._create_audit("Figma 진단")
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup",
                    "target": "mobile-web",
                    "selectionMode": "all-frames",
                    "flowName": None,
                },
            )
        self.assertEqual(queued.status_code, 202, queued.text)
        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)

        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(len(audit["screens"]), 2)
        self.assertEqual(audit["screens"][0]["flowStep"], "01_Product_Select")
        self.assertEqual(audit["screens"][0]["width"], 393)
        self.assertEqual(audit["screens"][1]["flowStep"], "02_Confirm")

        manifest_path = service.FIGMA_DIR / audit_id / "run-1" / "manifest.json"
        self.assertTrue(manifest_path.exists())

    def test_single_node_id_bypasses_type_filter(self) -> None:
        audit_id = self._create_audit("Figma 단일 노드")
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup?node-id=3-9",
                    "target": "mobile-web",
                    "selectionMode": "all-frames",
                    "flowName": None,
                },
            )
        self.assertEqual(queued.status_code, 202, queued.text)
        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)
        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(len(audit["screens"]), 1)  # GROUP 타입이지만 node-id 지정이라 선택됨

    def test_canvas_node_id_imports_its_screen_frames(self) -> None:
        audit_id = self._create_audit("Figma Canvas 링크")
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup?node-id=0-1",
                    "target": "mobile-web",
                    "selectionMode": "all-frames",
                    "flowName": None,
                },
            )
        self.assertEqual(queued.status_code, 202, queued.text)
        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)
        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(
            [screen["flowStep"] for screen in audit["screens"]],
            ["01_Product_Select", "02_Confirm"],
        )

    def test_partial_null_render_keeps_successful_frames(self) -> None:
        audit_id = self._create_audit("Figma 일부 실패")
        StubFigmaClient.null_node_ids = {"3:5"}
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup",
                    "target": "mobile-web",
                    "selectionMode": "all-frames",
                    "flowName": None,
                },
            )
        job_id = queued.json()["jobId"]
        job = self.client.get(f"/api/v1/analysis-jobs/{job_id}").json()
        self.assertEqual(job["status"], "completed", job)
        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(len(audit["screens"]), 1)

    def test_all_null_render_fails_job(self) -> None:
        audit_id = self._create_audit("Figma 전체 실패")
        StubFigmaClient.null_node_ids = {"3:2", "3:5"}
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup",
                    "target": "mobile-web",
                    "selectionMode": "all-frames",
                    "flowName": None,
                },
            )
        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "failed", job)

    def test_no_candidate_frames_fails_job(self) -> None:
        audit_id = self._create_audit("Figma 빈 파일")
        StubFigmaClient.document = {"children": [{"id": "0:1", "type": "CANVAS", "children": []}]}
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient):
            queued = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup",
                    "target": "mobile-web",
                    "selectionMode": "all-frames",
                    "flowName": None,
                },
            )
        job = self.client.get(f"/api/v1/analysis-jobs/{queued.json()['jobId']}").json()
        self.assertEqual(job["status"], "failed", job)

    def test_prototype_flow_imports_transition_order(self) -> None:
        audit_id = self._create_audit("Figma 프로토타입")
        StubFigmaClient.document = _PROTOTYPE_DOCUMENT
        with patch("backend.api.figma_import.FigmaClient", StubFigmaClient):
            response = self.client.post(
                f"/api/v1/audits/{audit_id}/figma",
                json={
                    "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup",
                    "target": "mobile-web",
                    "selectionMode": "prototype-flow",
                    "flowName": "가입 Flow",
                },
            )
        self.assertEqual(response.status_code, 202, response.text)
        job = self.client.get(f"/api/v1/analysis-jobs/{response.json()['jobId']}").json()
        self.assertEqual(job["status"], "completed", job)
        audit = self.client.get("/api/v1/dashboard/summary").json()["audits"][0]
        self.assertEqual(
            [screen["flowStep"] for screen in audit["screens"]],
            ["가입 시작", "가입 확인", "가입 완료"],
        )

    def test_invalid_url_rejected_with_400(self) -> None:
        audit_id = self._create_audit("Figma 잘못된 URL")
        response = self.client.post(
            f"/api/v1/audits/{audit_id}/figma",
            json={
                "fileUrl": "https://evil.example.com/design/abc123",
                "target": "mobile-web",
                "selectionMode": "all-frames",
                "flowName": None,
            },
        )
        self.assertEqual(response.status_code, 400, response.text)

    def test_missing_audit_returns_404(self) -> None:
        response = self.client.post(
            "/api/v1/audits/audit-999999/figma",
            json={
                "fileUrl": "https://www.figma.com/design/YtP0tCCij8KTBOiZXkzh9B/Mockup",
                "target": "mobile-web",
                "selectionMode": "all-frames",
                "flowName": None,
            },
        )
        self.assertEqual(response.status_code, 404, response.text)


if __name__ == "__main__":
    unittest.main()

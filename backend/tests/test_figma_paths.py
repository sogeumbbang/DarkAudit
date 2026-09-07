import json
from pathlib import Path
import unittest
from backend.api.demo_inputs import DEFAULT_FIGMA_FLOW
from backend.api.figma_frames import select_prototype_paths
from backend.api.figma_import import _resolve_frames
from backend.api.figma_client import FigmaSettings
from backend.api.schemas import ImportFigmaRequest


def document():
    frames = [
        {
            "id": str(i),
            "name": str(i),
            "type": "FRAME",
            "absoluteBoundingBox": {"width": 390, "height": 844},
            "children": [],
        }
        for i in range(1, 5)
    ]
    frames[0]["interactions"] = [
        {
            "actions": [
                {
                    "type": "CONDITIONAL",
                    "conditionalBlocks": [
                        {
                            "actions": [
                                {
                                    "type": "NODE",
                                    "destinationId": "2",
                                    "navigation": "NAVIGATE",
                                }
                            ]
                        },
                        {
                            "actions": [
                                {
                                    "type": "NODE",
                                    "destinationId": "3",
                                    "navigation": "NAVIGATE",
                                }
                            ]
                        },
                    ],
                }
            ]
        }
    ]
    frames[1]["interactions"] = [
        {"actions": [{"type": "NODE", "destinationId": "4", "navigation": "NAVIGATE"}]}
    ]
    return {
        "children": [
            {
                "id": "page",
                "type": "CANVAS",
                "flowStartingPoints": [{"nodeId": "1", "name": "Join"}],
                "children": frames,
            }
        ]
    }


class FigmaPathsTest(unittest.TestCase):
    def test_demo_named_flow_excludes_original_single_screen(self):
        fixture = Path(__file__).resolve().parents[2] / "demo/figma/online/graph.json"
        exported = json.loads(fixture.read_text(encoding="utf-8"))
        paths, warnings = select_prototype_paths(
            exported["document"], flow_name=DEFAULT_FIGMA_FLOW, max_frames=6
        )
        self.assertEqual(
            [[frame.node_id for frame in path] for path in paths],
            [["17:2", "19:3", "20:4", "23:5", "23:26", "24:7"]],
        )
        self.assertEqual(warnings, [])

    def test_rest_conditional_branches_are_separate_paths(self):
        paths, warnings = select_prototype_paths(
            document(), flow_name="Join", max_frames=5
        )
        self.assertEqual(
            [[f.node_id for f in p] for p in paths], [["1", "2", "4"], ["1", "3"]]
        )
        self.assertEqual(warnings, [])

    def test_node_link_does_not_override_flow_mode(self):
        class Client:
            def get_file(self, key):
                return {"document": document()}

        request = ImportFigmaRequest(
            fileUrl="https://figma.com/design/abc/Example",
            target="app",
            selectionMode="prototype-flow",
        )
        self.assertEqual(
            [
                f.node_id
                for f in _resolve_frames(
                    Client(), "abc", "1", request, FigmaSettings("test")
                )
            ],
            ["1", "2", "4"],
        )

    def test_limits_and_cycles_are_reported(self):
        paths, warnings = select_prototype_paths(
            document(), flow_name=None, max_frames=2
        )
        self.assertIn("figma_screen_limit", warnings)
        self.assertEqual(len(paths), 2)

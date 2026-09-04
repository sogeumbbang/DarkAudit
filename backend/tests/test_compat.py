from __future__ import annotations

import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.api import compat


class Finding:
    def __init__(self, rule_id: str, severity: str) -> None:
        self.ruleId = rule_id
        self.severity = severity


class FrontendContractTest(unittest.TestCase):
    def test_default_contract_is_v2(self) -> None:
        env = os.environ.copy()
        env.pop("DARKAUDIT_FRONTEND_CONTRACT", None)
        result = subprocess.run(
            [
                sys.executable,
                "-c",
                "from backend.api.compat import CONTRACT; print(CONTRACT)",
            ],
            cwd=Path(__file__).resolve().parents[2],
            env=env,
            check=True,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.stdout.strip(), "v2")

    def test_v2_exposes_da07_and_low_severity(self) -> None:
        finding = Finding("DA-07", "LOW")
        with patch.object(compat, "CONTRACT", "v2"):
            self.assertEqual(compat.filter_findings([finding]), [finding])
            self.assertEqual(finding.severity, "LOW")

    def test_v1_remains_available_for_rollback(self) -> None:
        da07 = Finding("DA-07", "LOW")
        da03 = Finding("DA-03", "LOW")
        with patch.object(compat, "CONTRACT", "v1"):
            self.assertEqual(compat.filter_findings([da07, da03]), [da03])
            self.assertEqual(da03.severity, "REVIEW")


if __name__ == "__main__":
    unittest.main()

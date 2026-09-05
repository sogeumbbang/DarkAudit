"""End-to-end audit orchestration."""

from ai.rules.rule_loader import RuleLoader
from ai.schemas.audit_input import AuditInput
from ai.schemas.audit_output import AuditOutput
from ai.vision.ocr import OCRProvider, OCRResult, OCRTextBlock, create_ocr_provider
from ai.vision.ui_parser import UIParser

from .detector import RuleDetector
from .suggestion import SuggestionGenerator


class AuditAnalyzer:
    def __init__(self, rule_loader: RuleLoader | None = None, ocr: OCRProvider | None = None) -> None:
        self.rule_loader = rule_loader or RuleLoader()
        self.ocr = ocr or create_ocr_provider()
        self.parser = UIParser()
        self.detector = RuleDetector()
        self.suggestions = SuggestionGenerator()

    def analyze(self, request: AuditInput, priority: str | None = None) -> AuditOutput:
        parsed = {}
        for screen in request.screens:
            result = self.ocr.extract(screen.image_path) if screen.image_path else OCRResult()
            if screen.text:
                result.blocks.insert(0, OCRTextBlock(text=screen.text))
            parsed[screen.screen_id] = self.parser.parse(result, screen.metadata)
        findings = []
        for rule in self.rule_loader.rules(priority=priority):
            finding = self.detector.detect(rule, parsed)
            if finding:
                findings.append(self.suggestions.apply(finding, rule))
        return AuditOutput(request.audit_id, findings, metadata={"screen_count": len(request.screens)})

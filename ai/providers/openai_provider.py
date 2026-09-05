"""OpenAI Responses API adapter with strict JSON Schema output."""
import base64
import json
import mimetypes
from typing import Any
from ai.schemas.audit_schema import LLMAuditRequest


def _responses_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Remove conditional JSON Schema keywords unsupported by Structured Outputs.

    The domain parser validates these cross-field constraints after generation, so
    removing them here changes only the API-facing schema, not output validation.
    """
    unsupported = {"allOf", "if", "then", "else"}
    normalized = {
        key: (
            _responses_schema(value)
            if isinstance(value, dict)
            else [_responses_schema(item) if isinstance(item, dict) else item for item in value]
            if isinstance(value, list)
            else value
        )
        for key, value in schema.items()
        if key not in unsupported
    }
    if "const" in normalized and "type" not in normalized:
        value = normalized["const"]
        normalized["type"] = (
            "boolean" if isinstance(value, bool)
            else "integer" if isinstance(value, int)
            else "number" if isinstance(value, float)
            else "string"
        )
    return normalized

def _rejects_temperature(exc: Exception) -> bool:
    """모델이 temperature 를 지원하지 않아 생긴 오류인지 본다.

    SDK 예외 타입은 버전마다 다르므로 메시지로 판단한다. 인증 실패나 정원 초과
    같은 다른 오류까지 무시하고 재시도하면 안 되므로 temperature 를 직접 언급한
    경우만 참으로 본다.
    """
    message = str(exc).lower()
    return "temperature" in message and any(
        hint in message
        for hint in ("unsupported", "not supported", "unknown", "does not support", "invalid")
    )


class OpenAIResponsesProvider:
    def __init__(self, model: str, client: Any | None = None) -> None:
        if not model.strip(): raise ValueError("model is required")
        if client is None:
            try:
                from openai import OpenAI
            except ImportError as exc:
                raise RuntimeError("Install the OpenAI SDK: pip install openai") from exc
            client = OpenAI()
        self.client = client
        self.model = model
        self.last_usage: dict[str, int] | None = None
        self.last_grounding_usage: dict[str, int] | None = None
        # 모델이 temperature 를 받는지는 호출해 봐야 안다. reasoning 계열은 거부한다.
        # None=아직 모름, True/False=한 번 확인한 결과.
        self._accepts_temperature: bool | None = None

    def _create(self, **kwargs: Any) -> Any:
        """
        temperature=0 으로 호출하되, 모델이 거부하면 빼고 다시 부른다.

        같은 화면을 두 번 분석했을 때 결과가 크게 달라지면 Before/After 비교에서
        "고쳐서 사라진 것"과 "이번엔 못 찾은 것"을 구분할 수 없다. 기본 temperature
        는 변동이 커서 재현성을 위해 0 으로 내린다.

        다만 reasoning 계열 모델은 이 파라미터 자체를 거부한다. 어떤 모델이 설정될지
        런타임에만 알 수 있으므로, 한 번 거부당하면 기억해 두고 이후로는 보내지 않는다.
        """
        if self._accepts_temperature is False:
            return self.client.responses.create(**kwargs)
        try:
            response = self.client.responses.create(temperature=0, **kwargs)
        except Exception as exc:
            if self._accepts_temperature is True or not _rejects_temperature(exc):
                raise
            self._accepts_temperature = False
            return self.client.responses.create(**kwargs)
        self._accepts_temperature = True
        return response

    @staticmethod
    def _data_url(path: Any) -> str:
        mime = mimetypes.guess_type(str(path))[0] or "image/png"
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{encoded}"

    def analyze(self, request: LLMAuditRequest, system_prompt: str, audit_prompt: str,
                rules: list[dict[str, Any]], output_schema: dict[str, Any],
                candidates: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        content: list[dict[str, Any]] = [
            {"type": "input_text", "text": audit_prompt},
            {
                "type": "input_text",
                "text": (
                    f"Copy these request identity fields exactly into the response: "
                    f"audit_id={request.audit_id}; schema_version={request.schema_version}"
                ),
            },
        ]
        for screen in request.screens:
            content.append({"type": "input_text", "text": f"screen_id={screen.screen_id}; flow_step={screen.flow_step}"})
            content.append({"type": "input_image", "image_url": self._data_url(screen.image_path), "detail": "high"})
        content.append({"type": "input_text", "text": "Rule Context:\n" + json.dumps(rules, ensure_ascii=False)})
        content.append({
            "type": "input_text",
            "text": (
                "Deterministic Candidates (signals, not conclusions):\n"
                + json.dumps(candidates or [], ensure_ascii=False)
                + "\nContract: Return exactly one KEEP or REJECT candidate_decision for every "
                  "candidate_id above. Never copy a candidate into semantic_findings. "
                  "Create semantic_findings only for the prompt's semantic-only checks. "
                  "Do not calculate final severity; preserve Rule Base severity."
            ),
        })
        response = self._create(
            model=self.model,
            instructions=system_prompt,
            input=[{"role": "user", "content": content}],
            text={"format": {"type": "json_schema", "name": "darkaudit_output", "schema": _responses_schema(output_schema), "strict": True}},
        )
        usage = getattr(response, "usage", None)
        self.last_usage = None if usage is None else {
            "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
            "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
            "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
        }
        if not getattr(response, "output_text", None):
            raise RuntimeError("Model returned no output_text")
        return json.loads(response.output_text)

    def select_bbox_candidate(
        self,
        marked_image_path: Any,
        element_text: str,
        candidates: list[dict[str, object]],
    ) -> dict[str, object] | None:
        """Select a marked proposal without asking the model to generate coordinates."""

        candidate_ids = [str(item["candidate_id"]) for item in candidates]
        if not candidate_ids:
            return None
        schema = {
            "type": "object",
            "additionalProperties": False,
            "required": ["candidate_id", "confidence", "reason"],
            "properties": {
                "candidate_id": {"enum": [*candidate_ids, "NONE"]},
                "confidence": {"type": "number", "minimum": 0, "maximum": 1},
                "reason": {"type": "string"},
            },
        }
        response = self._create(
            model=self.model,
            instructions=(
                "You are a GUI grounding verifier. Select the one marked candidate that tightly "
                "bounds the actual checkbox, radio, or toggle showing the selected state. "
                "Do not select an option card, text, price, badge, or decorative icon. "
                "Return NONE when no candidate is the control itself. Never calculate coordinates."
            ),
            input=[{
                "role": "user",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            f"Target evidence: {element_text}\n"
                            "The image is an enlarged crop; red boxes and C labels are candidate regions. "
                            "Choose only the exact selected-state control.\n"
                            f"Candidates: {json.dumps(candidates, ensure_ascii=False)}"
                        ),
                    },
                    {
                        "type": "input_image",
                        "image_url": self._data_url(marked_image_path),
                        "detail": "high",
                    },
                ],
            }],
            text={
                "format": {
                    "type": "json_schema",
                    "name": "bbox_candidate_selection",
                    "schema": schema,
                    "strict": True,
                }
            },
        )
        usage = getattr(response, "usage", None)
        self.last_grounding_usage = None if usage is None else {
            "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
            "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
            "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
        }
        if not getattr(response, "output_text", None):
            return None
        result = json.loads(response.output_text)
        if result.get("candidate_id") == "NONE":
            return None
        return result

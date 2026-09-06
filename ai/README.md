# DarkAudit AI Baseline

## Setup

```powershell
python -m pip install -r requirements.txt
```

## Run

```powershell
python -m ai.cli audit `
  --image .\screen_01.png --flow-step 상품안내 `
  --image .\screen_02.png --flow-step 결제
```

The CLI accepts one to five images in Flow order and writes an `{ "output": ..., "telemetry": ... }` JSON envelope. The selected model must support image input and Structured Outputs in the Responses API.

## Test

```powershell
python -m unittest discover -s ai/tests -v
```

Unit tests use a fake provider and do not require an API key.

## Evaluate the labelled dataset

The evaluator reads all label files in `data/synthetic/labels` (currently 22
clean/risky flows) and prediction JSON files from a directory:

```powershell
.venv\Scripts\python.exe -m ai.cli evaluate `
  --predictions data/evaluation/predictions `
  --input-usd-per-million 1.25 `
  --output-usd-per-million 10.00
```

Each prediction can be a raw audit output or an envelope. The envelope enables
latency, URL exploration, model cost, and schema retry metrics:

```json
{
  "flow_id": "ins-001-risky",
  "output": {"audit_id": "ins-001-risky", "screens": [], "detections": []},
  "telemetry": {
    "response_time_seconds": 2.4,
    "screen_count": 5,
    "url_exploration_success": true,
    "schema_attempts": 2,
    "schema_retries": 1,
    "usage": {"input_tokens": 1200, "output_tokens": 300}
  }
}
```

The report contains per-rule Precision/Recall/F1, Micro/Macro F1,
clean/risky counterfactual consistency, mean bbox IoU and localization success
at the configured threshold, URL exploration success, average response time,
cost per screen, and schema retry rate. Missing predictions are listed and are
excluded from metric denominators.

Copy `.env.example` to `.env`, then fill in the local values. Never commit `.env`.

## Audit a website URL

Install the Playwright browser once after installing Python dependencies:

```powershell
.venv\Scripts\python.exe -m playwright install chromium
```

Capture desktop and mobile screenshots without an AI navigation cost:

```powershell
.venv\Scripts\python.exe -m ai.cli capture-url `
  --url https://example.com `
  --mode quick
```

Run safe Computer Use exploration before the existing screenshot audit:

```powershell
.venv\Scripts\python.exe -m ai.cli audit-url `
  --url https://example.com `
  --mode smart `
  --model $env:DARKAUDIT_MODEL `
  --computer-model $env:DARKAUDIT_COMPUTER_MODEL
```

`quick` captures the initial viewport and full page for each requested device profile.
`smart` adds a screenshot-first Computer Use loop. The local policy only permits reversible
navigation and blocks typing, form submission, purchase/registration actions, private-network
targets, cross-origin navigation, downloads, and popups. Use `--allow-private-network` only for
explicit local development targets.

Screenshots are written beneath `data/captures/<audit-id>/<profile>/` by default. URL capture
manifests include text, control state and normalized geometry used by the shared Rule Engine.
All captured states and readable page crops are analyzed in batches of at most five, separately
for each device and path. Initial context, adjacent transitions and native first/final price
evidence are retained; exhaustive comparison of every distant pair is not guaranteed and is
reported as a limitation. `analysisBatches` preserves each v1.2 model response and rule assessment;
`analysis` is the merged finding view. Batch telemetry preserves evidence/grounding failures.

The supported scope is DA-03, DA-04, DA-07, DA-12 and DA-15. The [v1.2 contract](specs/rule_ai_contract.md)
defines required per-rule coverage and structured choice/price evidence. `telemetry.usage`
sums analysis retries and all successful grounding responses; `analysis_usage` and
`grounding_usage` expose the split. Navigation model usage is separate.

# Repository Guidelines

## Project Structure & Module Organization

DarkAudit analyzes financial-product screens for dark patterns.

- `ai/`: analysis pipelines, model providers, browser capture, vision, schemas, and `tests/`.
- `backend/api/`: FastAPI routes and orchestration; `backend/app/`: persistence, regression comparison, and deterministic rule engine. API tests live in `backend/tests/`.
- `frontend/src/`: React/TypeScript pages, features, components, and API clients; `frontend/e2e/`: browser tests; `frontend/public/`: static assets.
- `rules/`: authoritative YAML rules and build script.
- `data/`: synthetic dataset tooling, labels, and local runtime artifacts; `docs/`: deployment and labeling guides.

## Build, Test, and Development Commands

Use Python 3.10+ and Node.js 20+. Run Python commands from the repository root with your virtual environment activated:

```bash
python -m pip install -r requirements.txt
python -m uvicorn backend.api.main:app --reload --port 8000
python -m unittest discover -s ai/tests -v
python -m unittest discover -s backend/tests -v
python rules/build_rules.py --summary
```

These install dependencies, start the API, run both test suites, and validate/build rules.

From `frontend/`, run `npm install`, then:

- `npm run dev`: start Vite on port 5173.
- `npm run lint` and `npm run format:check`: check ESLint and Prettier rules.
- `npm run test`: run Vitest.
- `npm run build`: type-check and produce a production bundle.
- `npm run test:e2e` / `npm run test:a11y`: run Playwright flows/accessibility checks; configured browser channel is Chrome.

## Coding Style & Naming Conventions

Follow existing Python style: four-space indentation, type annotations, `snake_case` functions/modules, and `PascalCase` classes. TypeScript uses two-space indentation, double quotes, and semicolons; use Prettier via `npm run format`. Name React components `PascalCase` and hooks `useSomething`. Edit rules in YAML; generated rule JSON is ignored.

## Testing Guidelines

Use Python `unittest` with `test_*.py`; frontend tests use Vitest/Testing Library with colocated `*.test.ts(x)` files. Playwright uses `e2e/*.spec.ts`. Cover changed behavior and regressions using fake providers/MSW to avoid live API dependencies. No numeric coverage threshold is configured. Review visual changes before running `npm run test:e2e:update`.

## Commit & Pull Request Guidelines

History mixes imperative subjects such as “Handle Figma canvas links” with scoped prefixes such as `fix(ai):` and `feat(frontend):`. Keep commits focused and descriptive. PRs should explain the behavior change, link relevant issues, list validation performed, and include screenshots for UI changes.

## Configuration & Secrets

Start from `.env.example`; use `DARKAUDIT_PROVIDER=fake` for local demos. Configure frontend mocks with `VITE_USE_MOCKS`. Never commit secrets, `.env`, databases, or captured/uploaded images.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { FindingDecisionNote } from "./FindingDecisionNote";
import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";

const first = { ...dashboardFixture.audits[0]!.findings[0]!, decisionNote: "" };
const second = { ...dashboardFixture.audits[0]!.findings[1]!, decisionNote: "" };

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = (finding = first) => (
    <QueryClientProvider client={client}>
      <FindingDecisionNote finding={finding} />
    </QueryClientProvider>
  );
  return { ...render(view()), view };
}

it("keeps separate drafts when switching findings", async () => {
  const user = userEvent.setup();
  const { rerender, view } = setup();
  await user.type(screen.getByRole("textbox"), "기본 선택 해제");
  rerender(view(second));
  expect(screen.getByRole("textbox")).toHaveValue("");
  await user.type(screen.getByRole("textbox"), "문구 수정");
  rerender(view(first));
  expect(screen.getByRole("textbox")).toHaveValue("기본 선택 해제");
});

it("saves a decision and displays the persisted record when opened again", async () => {
  const user = userEvent.setup();
  let saved = "";
  server.use(
    http.put("*/api/v1/findings/:findingId/decision", async ({ request }) => {
      saved = ((await request.json()) as { decisionNote: string }).decisionNote;
      return HttpResponse.json({
        id: first.id,
        decisionNote: saved,
        decisionUpdatedAt: "2026-09-23T00:00:00Z",
      });
    }),
  );
  const { rerender, view } = setup();
  await user.type(screen.getByRole("textbox"), "기본 선택 해제");
  await user.click(screen.getByRole("button", { name: "결정 저장" }));
  await waitFor(() => expect(saved).toBe("기본 선택 해제"));
  rerender(view({ ...first, decisionNote: saved, decisionUpdatedAt: "2026-09-23T00:00:00Z" }));
  expect(screen.getByRole("textbox")).toHaveValue(saved);
  expect(screen.getByRole("status")).toHaveTextContent("마지막 저장");
  expect(screen.getByRole("button", { name: "결정 저장" })).toBeDisabled();
});

it("keeps text on failure and allows retrying", async () => {
  const user = userEvent.setup();
  server.use(
    http.put(
      "*/api/v1/findings/:findingId/decision",
      () => new HttpResponse(null, { status: 500 }),
    ),
  );
  setup();
  await user.type(screen.getByRole("textbox"), "추가 비용 안내");
  await user.click(screen.getByRole("button", { name: "결정 저장" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("저장하지 못했습니다");
  expect(screen.getByRole("textbox")).toHaveValue("추가 비용 안내");
  expect(screen.getByRole("button", { name: "결정 저장" })).toBeEnabled();
});

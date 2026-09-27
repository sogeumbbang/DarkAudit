import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { FindingDecisionNote } from "./FindingDecisionNote";
import { dashboardFixture } from "@/mocks/fixtures/dashboard";
import { server } from "@/mocks/server";

const first = { ...dashboardFixture.audits[0]!.findings[0]!, decisionNote: "" };
const second = { ...dashboardFixture.audits[0]!.findings[1]!, decisionNote: "" };

function setup(initial = first) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const view = (finding = initial) => (
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

function captureSaves() {
  const saves: string[] = [];
  server.use(
    http.put("*/api/v1/findings/:findingId/decision", async ({ request }) => {
      const { decisionNote } = (await request.json()) as { decisionNote: string };
      saves.push(decisionNote);
      return HttpResponse.json({
        id: first.id,
        decisionNote: decisionNote.trim(),
        decisionUpdatedAt: "2026-09-23T00:00:00Z",
      });
    }),
  );
  return saves;
}

it("shows the saved decision above the input and clears the input", async () => {
  const user = userEvent.setup();
  const saves = captureSaves();
  setup();
  await user.type(screen.getByRole("textbox"), "기본 선택 해제");
  await user.click(screen.getByRole("button", { name: "결정 저장" }));
  const record = await screen.findByRole("article", { name: "저장된 결정" });
  expect(saves).toEqual(["기본 선택 해제"]);
  expect(within(record).getByText("기본 선택 해제")).toBeInTheDocument();
  expect(record).toHaveTextContent("마지막 저장");
  expect(screen.getByRole("textbox")).toHaveValue("");
  expect(screen.getByRole("button", { name: "결정 덮어쓰기" })).toBeDisabled();
});

it("overwrites the saved decision with a new one", async () => {
  const user = userEvent.setup();
  const saves = captureSaves();
  setup({ ...first, decisionNote: "기존 결정", decisionUpdatedAt: "2026-09-22T00:00:00Z" });
  const record = screen.getByRole("article", { name: "저장된 결정" });
  expect(record).toHaveTextContent("기존 결정");
  await user.click(within(record).getByRole("button", { name: "수정" }));
  expect(screen.getByRole("textbox")).toHaveValue("기존 결정");
  await user.clear(screen.getByRole("textbox"));
  await user.type(screen.getByRole("textbox"), "새 결정");
  await user.click(screen.getByRole("button", { name: "결정 덮어쓰기" }));
  await waitFor(() => expect(record).toHaveTextContent("새 결정"));
  expect(record).not.toHaveTextContent("기존 결정");
  expect(saves).toEqual(["새 결정"]);
  expect(screen.getByRole("textbox")).toHaveValue("");
});

it("does not show a record before anything is saved", () => {
  setup();
  expect(screen.queryByRole("article", { name: "저장된 결정" })).not.toBeInTheDocument();
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

it("deletes the saved decision after confirmation", async () => {
  const user = userEvent.setup();
  const saves = captureSaves();
  setup({ ...first, decisionNote: "기존 결정", decisionUpdatedAt: "2026-09-22T00:00:00Z" });
  const record = screen.getByRole("article", { name: "저장된 결정" });
  await user.click(within(record).getByRole("button", { name: "삭제" }));
  await user.click(within(record).getByRole("button", { name: "취소" }));
  expect(saves).toEqual([]);
  await user.click(within(record).getByRole("button", { name: "삭제" }));
  await user.click(within(record).getByRole("button", { name: "삭제 확인" }));
  await waitFor(() =>
    expect(screen.queryByRole("article", { name: "저장된 결정" })).not.toBeInTheDocument(),
  );
  expect(saves).toEqual([""]);
  expect(screen.getByRole("button", { name: "결정 저장" })).toBeDisabled();
});

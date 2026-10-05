import { act, fireEvent, render, screen } from "@testing-library/react";

import { analysisJobSchema } from "@/api/schemas";
import { resolveApiUrl } from "@/api/client";
import type { ExplorationEventDto } from "@/entities/audit/types";
import { ExplorationViewer } from "@/pages/audit-create/ExplorationViewer";

const first: ExplorationEventDto = {
  id: 1,
  kind: "capture",
  label: "첫 화면 확인",
  profile: "mobile",
  imageUrl: "/artifacts/first.png",
  width: 400,
  height: 800,
  fullPage: false,
};
const action: ExplorationEventDto = {
  ...first,
  id: 2,
  kind: "action",
  label: "클릭 실행",
  actionType: "click",
  x: 0.25,
  y: 0.5,
};
const result: ExplorationEventDto = {
  ...first,
  id: 3,
  kind: "result",
  label: "동작 후 화면 확인",
  imageUrl: "/artifacts/after.png",
};

it("retains server events through response parsing and accepts older jobs", () => {
  const job = { jobId: "job", auditId: "audit", status: "analyzing", progress: 12 };
  expect(analysisJobSchema.parse(job).explorationEvents).toBeUndefined();
  expect(
    analysisJobSchema.parse({ ...job, explorationEvents: [first, action] }).explorationEvents,
  ).toEqual([first, action]);
});

it("pins history while new frames arrive and returns to the latest screen", () => {
  const { rerender } = render(
    <ExplorationViewer
      running
      exploration={{ mode: "smart", stage: "capturing", events: [first, action] }}
    />,
  );
  expect(screen.getByRole("img", { name: "동작 위치" })).toHaveStyle({ left: "25%", top: "50%" });
  fireEvent.click(screen.getByRole("button", { name: /2. 클릭 실행/ }));
  rerender(
    <ExplorationViewer
      running
      exploration={{ mode: "smart", stage: "capturing", events: [first, action, result] }}
    />,
  );
  expect(screen.getByRole("img", { name: /클릭 실행 —/ })).toHaveAttribute(
    "src",
    resolveApiUrl(first.imageUrl),
  );
  fireEvent.click(screen.getByRole("button", { name: "최신 화면 보기" }));
  expect(screen.getByRole("img", { name: /동작 후 화면 확인 —/ })).toHaveAttribute(
    "src",
    resolveApiUrl(result.imageUrl),
  );
  expect(screen.queryByRole("img", { name: "동작 위치" })).not.toBeInTheDocument();
  rerender(
    <ExplorationViewer
      running={false}
      exploration={{ mode: "smart", stage: "failed", events: [first, action, result] }}
    />,
  );
  expect(screen.queryByText("실시간 화면 수집 중")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /2. 클릭 실행/ })).toBeInTheDocument();
});

it("shows quick captures, empty and unavailable screens honestly", () => {
  const { rerender } = render(
    <ExplorationViewer running exploration={{ mode: "quick", stage: "capturing", events: [] }} />,
  );
  expect(screen.queryByText("COMPUTER USE")).not.toBeInTheDocument();
  expect(screen.getByText(/첫 화면이 도착하면/)).toBeInTheDocument();
  rerender(
    <ExplorationViewer
      running
      exploration={{ mode: "quick", stage: "analyzing", events: [first] }}
    />,
  );
  expect(screen.getByRole("status")).toHaveTextContent("수집한 화면 분석 중");
  fireEvent.error(screen.getByRole("img"));
  expect(screen.getByText(/이 화면을 불러올 수 없습니다/)).toBeInTheDocument();
});

it("shows the action before its result even when both arrive in one poll", () => {
  vi.useFakeTimers();
  try {
    const { rerender } = render(
      <ExplorationViewer
        running
        exploration={{ mode: "smart", stage: "capturing", events: [first] }}
      />,
    );
    rerender(
      <ExplorationViewer
        running
        exploration={{ mode: "smart", stage: "capturing", events: [first, action, result] }}
      />,
    );
    act(() => vi.advanceTimersByTime(450));
    expect(screen.getByRole("img", { name: "동작 위치" })).toBeInTheDocument();
    // Repeated polls must not restart the presentation timer indefinitely.
    act(() => vi.advanceTimersByTime(800));
    rerender(
      <ExplorationViewer
        running
        exploration={{
          mode: "smart",
          stage: "capturing",
          events: structuredClone([first, action, result]),
        }}
      />,
    );
    act(() => vi.advanceTimersByTime(300));
    expect(screen.queryByRole("img", { name: "동작 위치" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: /동작 후 화면 확인 —/ })).toBeInTheDocument();
    expect(screen.getByText("화면을 관찰하고 다음 동작 판단 중")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

it("replays a recent action when the first poll already includes capture completion", () => {
  render(
    <ExplorationViewer
      running
      exploration={{
        mode: "smart",
        stage: "analyzing",
        events: [
          first,
          action,
          result,
          { ...result, id: 4, kind: "complete", label: "화면 수집 완료" },
        ],
      }}
    />,
  );
  expect(screen.getByRole("img", { name: "동작 위치" })).toBeInTheDocument();
  expect(screen.getByText("실행된 동작 재생 중")).toBeInTheDocument();
  expect(screen.queryByText("화면을 관찰하고 다음 동작 판단 중")).not.toBeInTheDocument();
});

it("does not animate history, terminal jobs or fabricate click effects for scrolling", () => {
  const scroll: ExplorationEventDto = {
    ...action,
    actionType: "scroll",
    scrollY: -300,
    label: "스크롤 실행",
  };
  const { container, rerender } = render(
    <ExplorationViewer
      running
      exploration={{ mode: "smart", stage: "capturing", events: [first, scroll] }}
    />,
  );
  expect(screen.getByRole("img", { name: "스크롤 실행" })).toBeInTheDocument();
  expect(container.querySelector(".is-click")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /1. 첫 화면 확인/ }));
  expect(container.querySelector(".is-animated")).toBeNull();
  expect(container.querySelector(".exploration-scan")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "최신 화면 보기" }));
  rerender(
    <ExplorationViewer
      running={false}
      exploration={{ mode: "smart", stage: "failed", events: [first, scroll, result] }}
    />,
  );
  expect(container.querySelector(".is-animated")).toBeNull();
  expect(screen.getByRole("img", { name: /동작 후 화면 확인 —/ })).toBeInTheDocument();
});

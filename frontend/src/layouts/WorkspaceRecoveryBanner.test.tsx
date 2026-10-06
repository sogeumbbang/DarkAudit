import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WORKSPACE_REJECTED_EVENT } from "@/api/client";
import { WorkspaceRecoveryBanner } from "./WorkspaceRecoveryBanner";

describe("WorkspaceRecoveryBanner", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("stays hidden until the server rejects the workspace, then resets on request", async () => {
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });
    localStorage.setItem("darkaudit.workspace:same-origin", "a".repeat(43));
    render(<WorkspaceRecoveryBanner />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      window.dispatchEvent(new Event(WORKSPACE_REJECTED_EVENT));
    });
    await userEvent.click(screen.getByRole("button", { name: "새 작업공간으로 시작" }));

    expect(localStorage.getItem("darkaudit.workspace:same-origin")).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

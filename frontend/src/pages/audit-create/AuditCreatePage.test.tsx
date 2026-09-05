import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { AuditCreatePage } from "@/pages/audit-create/AuditCreatePage";

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <AuditCreatePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function expectCompleted() {
  expect(
    await screen.findByRole("heading", { name: "진단이 완료되었습니다" }, { timeout: 7_000 }),
  ).toBeInTheDocument();
}

describe("AuditCreatePage", () => {
  it("derives platform options from the selected source", async () => {
    const user = userEvent.setup();
    renderPage();
    expect(screen.queryByLabelText("플랫폼")).not.toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Figma/ }));
    expect(screen.getByLabelText("Figma 파일 링크")).toBeInTheDocument();
    expect(screen.queryByText("Figma 계정 연결")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "모바일 앱" })).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: /Android 앱/ }));
    expect(screen.queryByText(/테스트 기기|화면 유형|Pixel|Galaxy/)).not.toBeInTheDocument();
    expect(screen.getByText(/iOS 자동화에는.*별도의 기기 runner/)).toBeInTheDocument();
  });

  it("captures a website for desktop and mobile", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(screen.getByLabelText("진단 이름"), "URL 자동 진단");
    await user.type(screen.getByLabelText("검사할 웹사이트 주소"), "https://example.com/product");
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    expect(
      await screen.findByRole("heading", { name: "사이트를 캡처하고 분석하고 있습니다" }),
    ).toBeInTheDocument();
    await expectCompleted();
  }, 10_000);

  it("imports and analyzes a Figma flow", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("tab", { name: /Figma/ }));
    await user.type(screen.getByLabelText("진단 이름"), "Figma 사전 진단");
    await user.type(
      screen.getByLabelText("Figma 파일 링크"),
      "https://www.figma.com/design/file-key/demo",
    );
    await user.type(screen.getByLabelText(/Flow 이름 또는 설명/), "보험 가입 Flow");
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    expect(
      await screen.findByRole("heading", { name: "Figma 프레임과 레이어를 분석하고 있습니다" }),
    ).toBeInTheDocument();
    await expectCompleted();
  }, 10_000);

  it("uploads an APK for Android emulator analysis", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(screen.getByRole("tab", { name: /Android 앱/ }));
    await user.type(screen.getByLabelText("진단 이름"), "Android 앱 진단");
    const appInput = container.querySelector<HTMLInputElement>('input[accept*=".apk"]')!;
    await user.upload(
      appInput,
      new File(["apk"], "audit-app.apk", { type: "application/vnd.android.package-archive" }),
    );
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    expect(
      await screen.findByRole("heading", { name: "Android 앱을 실행하고 탐색하고 있습니다" }),
    ).toBeInTheDocument();
    await expectCompleted();
  }, 10_000);

  it("keeps manual screenshots as a fallback", async () => {
    const user = userEvent.setup();
    const { container } = renderPage();
    await user.click(screen.getByRole("tab", { name: /스크린샷/ }));
    await user.type(screen.getByLabelText("진단 이름"), "스크린샷 진단");
    const fileInput = container.querySelector<HTMLInputElement>('input[accept^="image/"]')!;
    await user.upload(fileInput, new File(["screen"], "screen.png", { type: "image/png" }));
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    expect(
      await screen.findByRole("heading", { name: "등록한 화면을 분석하고 있습니다" }),
    ).toBeInTheDocument();
    await expectCompleted();
  }, 10_000);
});

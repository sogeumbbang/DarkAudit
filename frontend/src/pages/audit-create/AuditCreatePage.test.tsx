import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { http, HttpResponse } from "msw";

import { AuditCreatePage } from "@/pages/audit-create/AuditCreatePage";
import { server } from "@/mocks/server";

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
  it("loads all six pet insurance screenshots in flow order", async () => {
    server.use(
      http.get(
        "*/sample-audit/:filename",
        () =>
          new HttpResponse(new Uint8Array([137, 80, 78, 71]), {
            headers: { "Content-Type": "image/png" },
          }),
      ),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole("button", { name: "스크린샷 데모 불러오기" }));
    expect(await screen.findByLabelText("6번 화면 단계 이름")).toHaveValue("최종 보험료");
    expect(screen.getByLabelText("1번 화면 단계 이름")).toHaveValue("보장 소개");
    expect(screen.getAllByRole("button", { name: "화면 삭제" })).toHaveLength(6);
  });

  it("loads URL demo settings and submits the real capture flow", async () => {
    const user = userEvent.setup();
    let capture: Record<string, unknown> | undefined;
    server.use(
      http.post("*/api/v1/audits/:id/capture", async ({ request }) => {
        capture = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          jobId: "demo-job",
          auditId: "demo-audit",
          status: "queued",
          progress: 0,
        });
      }),
    );
    renderPage();
    const button = await screen.findByRole("button", { name: "URL 데모 불러오기" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(screen.getByLabelText("진단 이름")).toHaveValue("URL 데모 · 로밍 패스 환전 멤버십");
    expect((screen.getByLabelText("검사할 웹사이트 주소") as HTMLInputElement).value).toContain(
      "/demo/web/index.html?step=1",
    );
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    await waitFor(() => expect(capture).toMatchObject({ mode: "smart", profiles: ["mobile"] }));
  });

  it("selects the named six-screen prototype when supplied by demo configuration", async () => {
    let imported: Record<string, unknown> | undefined;
    server.use(
      http.get("*/api/v1/demo-inputs", () =>
        HttpResponse.json({
          website: { url: "/demo/web/index.html?step=1", available: true },
          figma: {
            fileUrl: "https://www.figma.com/design/demo-file/Lit",
            available: true,
            reason: null,
            selectionMode: "prototype-flow",
            flowName: "릿 크레딧 · 6단계",
          },
          android: { downloadUrl: "/demo/darkaudit-demo.apk", available: false, reason: null },
        }),
      ),
      http.post("*/api/v1/audits/:id/figma", async ({ request }) => {
        imported = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({
          jobId: "figma-demo",
          auditId: "demo",
          status: "queued",
          progress: 0,
        });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole("button", { name: "Figma 데모 불러오기" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(screen.getByLabelText(/Flow 이름 또는 설명/)).toHaveValue("릿 크레딧 · 6단계");
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    await waitFor(() =>
      expect(imported).toMatchObject({
        selectionMode: "prototype-flow",
        flowName: "릿 크레딧 · 6단계",
      }),
    );
  });

  it("loads the configured Figma file and selects all frames", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole("button", { name: "Figma 데모 불러오기" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(screen.getByLabelText("Figma 파일 링크")).toHaveValue(
      "https://www.figma.com/design/demo-file/Banking-Demo",
    );
    expect(screen.queryByLabelText(/Flow 이름 또는 설명/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("진단 이름")).toHaveValue("Figma 데모 · 금융상품 화면 검사");
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    await expectCompleted();
  }, 10_000);

  it("downloads a demo APK and submits it without a manual upload", async () => {
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole("button", { name: "APK 데모 불러오기" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(await screen.findByText("darkaudit-demo.apk")).toBeInTheDocument();
    expect(screen.getByLabelText("진단 이름")).toHaveValue("APK 데모 · 모아 소액투자");
    await user.click(screen.getByRole("button", { name: "분석 시작하기" }));
    await expectCompleted();
  }, 10_000);

  it("keeps the form intact when the APK download is an HTML error page", async () => {
    server.use(
      http.get("*/demo/darkaudit-demo.apk", () => HttpResponse.html("<html>Error</html>")),
    );
    const user = userEvent.setup();
    renderPage();
    const button = await screen.findByRole("button", { name: "APK 데모 불러오기" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "데모 APK 파일을 확인할 수 없습니다",
    );
    expect(screen.queryByText("darkaudit-demo.apk")).not.toBeInTheDocument();
    expect(button).toBeEnabled();
  });

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

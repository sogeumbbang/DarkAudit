import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/mocks/server";
import { dashboardFixture } from "@/mocks/fixtures/dashboard";

import { MemoryRouter } from "react-router-dom";

import { OverviewPage } from "@/pages/overview/OverviewPage";

function renderPage(path = "/app/overview?finding=finding-preselected-option") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <OverviewPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("OverviewPage", () => {
  it("distinguishes screen counts from audit counts, including related findings only once", async () => {
    const fixture = structuredClone(dashboardFixture);
    const shared = fixture.audits[0]!.findings[2]!;
    shared.screenIds = ["screen-review"];
    shared.relatedElements!.push({ ...shared.relatedElements![0]! });
    server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
    renderPage();
    const flow = within(await screen.findByRole("group", { name: "가입 흐름 단계" }));
    expect(flow.getByRole("button", { name: "2단계 옵션 선택, 문제 2건" })).toBeInTheDocument();
    expect(screen.getByLabelText(/현재 화면 문제 수/)).toHaveTextContent("이 화면 2건");
    expect(screen.getByRole("heading", { name: "전체 진단 문제 3건" })).toBeInTheDocument();
    const header = within(screen.getByRole("navigation", { name: "점검 항목" })).getByRole(
      "button",
      { name: /유료 옵션 사전 선택/ },
    );
    expect(header).not.toHaveTextContent("DA-04");
    await userEvent.click(screen.getByText("판단 근거 및 가이드라인"));
    expect(screen.getByRole("heading", { name: "RULE · 검토 기준" })).toBeVisible();
    expect(screen.getByText("DA-04")).toBeVisible();
    await userEvent.click(
      within(screen.getByRole("group", { name: "점검 항목 필터" })).getByRole("button", {
        name: "검토 필요 2",
      }),
    );
    expect(screen.getByText("필터 적용: 이 화면의 2건 중 1건 표시")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "전체 진단 문제 2 / 3건" })).toBeInTheDocument();
    expect(flow.getByRole("button", { name: "2단계 옵션 선택, 문제 2건" })).toBeInTheDocument();
    await userEvent.click(flow.getByRole("button", { name: "1단계 상품 안내, 문제 0건" }));
    expect(screen.getByLabelText(/현재 화면 문제 수/)).toHaveTextContent("이 화면 0건");
  });

  it("keeps the list visible and expands explanations without changing image zoom", async () => {
    renderPage("/app/overview");
    const image = await screen.findByRole("img", { name: "옵션 선택 캡처 화면 미리보기" });
    const list = within(screen.getByRole("navigation", { name: "점검 항목" }));
    expect(list.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(screen.queryByRole("heading", { name: "탐지 항목 상세" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("미리보기 배율")).toHaveTextContent("100%");
    Object.defineProperties(image, { offsetWidth: { value: 390 }, offsetHeight: { value: 844 } });
    fireEvent.load(image);
    const marker = screen.getByRole("button", { name: "1번 유료 옵션 사전 선택 탐지 영역" });
    expect(marker).toHaveStyle({ width: "30px", height: "30px" });
    await userEvent.click(marker);
    expect(list.getByRole("button", { name: /유료 옵션 사전 선택/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(marker).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("미리보기 배율")).toHaveTextContent("100%");
    await userEvent.click(screen.getByRole("button", { name: "확대" }));
    await userEvent.click(screen.getByRole("button", { name: "2번 순차적 가격 공개 관련 영역" }));
    expect(screen.getByLabelText("미리보기 배율")).toHaveTextContent("125%");
    expect(screen.getAllByRole("heading", { name: "탐지 항목 상세" })).toHaveLength(1);
    await userEvent.click(list.getByRole("button", { name: /순차적 가격 공개/ }));
    expect(screen.queryByRole("heading", { name: "탐지 항목 상세" })).not.toBeInTheDocument();
    expect(list.getAllByRole("heading", { level: 3 })).toHaveLength(3);
    expect(screen.getByLabelText("미리보기 배율")).toHaveTextContent("125%");
    await userEvent.click(screen.getByRole("button", { name: "다음 미검토 항목" }));
    await userEvent.click(screen.getByRole("button", { name: "화면 전체 보기" }));
    expect(screen.getByLabelText("미리보기 배율")).toHaveTextContent("100%");
    expect(list.getByRole("button", { name: /유료 옵션 사전 선택/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  it("keeps findings without coordinates accessible from the visible list", async () => {
    const fixture = structuredClone(dashboardFixture);
    fixture.audits[0]!.findings[0]!.bbox = null;
    server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
    renderPage("/app/overview");
    await screen.findByRole("navigation", { name: "점검 항목" });
    const list = within(screen.getByRole("navigation", { name: "점검 항목" }));
    await userEvent.click(list.getByRole("button", { name: /유료 옵션 사전 선택/ }));
    expect(
      screen.getByText("위치 정보가 없는 항목입니다. 상세 설명을 확인해주세요."),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("region", { name: "선택한 항목 검토" })).getByRole("heading", {
        name: "유료 옵션 사전 선택",
      }),
    ).toBeInTheDocument();
  });

  it("links related image marks to details without changing screens and preserves report numbers in filters", async () => {
    const fixture = structuredClone(dashboardFixture);
    fixture.audits[0]!.findings.reverse();
    fixture.audits[0]!.screens.reverse();
    server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
    renderPage();
    const image = await screen.findByRole("img", { name: "옵션 선택 캡처 화면 미리보기" });
    Object.defineProperties(image, { offsetWidth: { value: 390 }, offsetHeight: { value: 844 } });
    fireEvent.load(image);
    await userEvent.click(screen.getByRole("button", { name: "2번 순차적 가격 공개 관련 영역" }));
    expect(screen.getByRole("img", { name: "옵션 선택 캡처 화면 미리보기" })).toBe(image);
    const detail = within(screen.getByRole("region", { name: "선택한 항목 검토" }));
    expect(detail.getByRole("heading", { name: "순차적 가격 공개" })).toBeInTheDocument();
    expect(detail.getByLabelText("항목 2번")).toHaveTextContent("2");
    const list = within(screen.getByRole("navigation", { name: "점검 항목" }));
    expect(list.getByRole("button", { name: /순차적 가격 공개/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await userEvent.click(list.getByRole("button", { name: /순차적 가격 공개/ }));
    await userEvent.click(list.getByRole("button", { name: /순차적 가격 공개/ }));
    expect(screen.getByRole("img", { name: "최종 확인 캡처 화면 미리보기" })).toBeInTheDocument();
    await userEvent.click(
      within(screen.getByRole("group", { name: "점검 항목 필터" })).getByRole("button", {
        name: "해결됨 1",
      }),
    );
    expect(list.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(
      within(list.getByRole("button", { name: /순차적 가격 공개/ })).getByText("2"),
    ).toBeInTheDocument();
    expect(detail.getByLabelText("항목 2번")).toBeInTheDocument();
  });

  it("shows review status without severity labels", async () => {
    const fixture = structuredClone(dashboardFixture);
    fixture.audits[0]!.findings[2]!.severity = "HIGH";
    server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
    renderPage();
    const list = within(await screen.findByRole("navigation", { name: "점검 항목" }));
    const reviewing = within(list.getByRole("button", { name: /유료 옵션 사전 선택/ }));
    expect(screen.queryByText(/심각도/)).not.toBeInTheDocument();
    expect(reviewing.getByText("검토 중")).toBeInTheDocument();
    const resolved = within(list.getByRole("button", { name: /순차적 가격 공개/ }));
    expect(resolved.getByText("해결됨")).toBeInTheDocument();
  });

  it("keeps summary filters, list filters and detail arrows in sync", async () => {
    const user = userEvent.setup();
    renderPage();
    const summary = within(await screen.findByRole("region", { name: "진단 요약" }));
    const filters = within(screen.getByRole("group", { name: "점검 항목 필터" }));
    const list = within(screen.getByRole("navigation", { name: "점검 항목" }));
    await user.click(summary.getByRole("button", { name: "검토 필요 2" }));
    expect(filters.getByRole("button", { name: "검토 필요 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(list.getAllByRole("heading", { level: 3 })).toHaveLength(2);
    expect(list.queryByRole("button", { name: /순차적 가격 공개/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 탐지 항목" }));
    expect(screen.getByText("2 / 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 탐지 항목" }));
    expect(screen.getByText("1 / 2")).toBeInTheDocument();
    await user.click(filters.getByRole("button", { name: "해결됨 1" }));
    expect(summary.getByRole("button", { name: "해결됨 1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(list.getAllByRole("heading", { level: 3 })).toHaveLength(1);
    expect(screen.getByText("1 / 1")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 미검토 항목" }));
    expect(filters.getByRole("button", { name: "검토 필요 2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(list.getByRole("button", { name: /감정적 압박/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("restores the URL filter and shows an empty state without an unrelated finding", async () => {
    const fixture = structuredClone(dashboardFixture);
    fixture.audits[0]!.findings.forEach((finding) => {
      finding.status = "open";
    });
    server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
    renderPage("/app/overview?filter=resolved&finding=finding-preselected-option");
    const list = await screen.findByRole("navigation", { name: "점검 항목" });
    expect(within(list).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "해결된 항목이 없습니다" })).toBeInTheDocument();
    expect(screen.getByText("0 / 0")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /해결하고 다음/ })).not.toBeInTheDocument();
  });

  it("advances only after saving and finishes with no remaining review items", async () => {
    const user = userEvent.setup();
    const fixture = structuredClone(dashboardFixture);
    let finishSave!: () => void;
    let startSave!: () => void;
    const pendingSave = new Promise<void>((resolve) => {
      finishSave = resolve;
    });
    const saveStarted = new Promise<void>((resolve) => {
      startSave = resolve;
    });
    server.use(
      http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)),
      http.patch("*/api/v1/findings/:findingId", async ({ params, request }) => {
        const finding = fixture.audits[0]!.findings.find((item) => item.id === params.findingId)!;
        const body = (await request.json()) as { status: typeof finding.status };
        if (finding.id === "finding-preselected-option" && body.status === "resolved") {
          startSave();
          await pendingSave;
        }
        finding.status = body.status;
        return HttpResponse.json({ id: finding.id, status: finding.status });
      }),
    );
    renderPage();
    await user.click(await screen.findByRole("button", { name: "해결하고 다음 미검토 항목" }));
    await saveStarted;
    const list = within(screen.getByRole("navigation", { name: "점검 항목" }));
    try {
      expect(screen.getByRole("button", { name: "상태 저장 중…" })).toBeDisabled();
      expect(list.getByRole("button", { name: /유료 옵션 사전 선택/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(list.getByRole("button", { name: /감정적 압박/ })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    } finally {
      finishSave();
    }
    const detail = within(screen.getByRole("region", { name: "선택한 항목 검토" }));
    // All list titles exist before saving; wait for the actual review transition.
    await waitFor(() => {
      expect(list.getByRole("button", { name: /감정적 압박/ })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(screen.getByRole("button", { name: "다음 미검토 항목" })).toBeDisabled();
    });
    await user.click(screen.getByRole("button", { name: "해결됨으로 표시" }));
    await waitFor(() =>
      expect(
        detail.getByRole("heading", { name: "검토가 필요한 항목이 없습니다" }),
      ).toBeInTheDocument(),
    );
    expect(
      within(screen.getByRole("navigation", { name: "점검 항목" })).queryAllByRole("button"),
    ).toHaveLength(0);
    const filters = within(screen.getByRole("group", { name: "점검 항목 필터" }));
    await user.click(filters.getByRole("button", { name: "해결됨 3" }));
    await user.click(screen.getByRole("button", { name: "검토 상태로 되돌리기" }));
    await waitFor(() =>
      expect(filters.getByRole("button", { name: "검토 필요 1" })).toBeInTheDocument(),
    );
    await user.click(filters.getByRole("button", { name: "검토 필요 1" }));
    expect(detail.getByText("검토 중")).toBeInTheDocument();
  });

  it("keeps the current item and count when saving its status fails", async () => {
    server.use(
      http.patch("*/api/v1/findings/:findingId", () =>
        HttpResponse.json({ message: "failed" }, { status: 500 }),
      ),
    );
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "해결하고 다음 미검토 항목" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("상태를 저장하지 못했습니다");
    const detail = within(screen.getByRole("region", { name: "선택한 항목 검토" }));
    expect(detail.getByRole("heading", { name: "유료 옵션 사전 선택" })).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
  });

  it("does not change selection when a pending save finishes after navigation", async () => {
    const fixture = structuredClone(dashboardFixture);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    server.use(
      http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)),
      http.patch("*/api/v1/findings/:findingId", async () => {
        await pending;
        fixture.audits[0]!.findings[0]!.status = "resolved";
        return HttpResponse.json({ id: fixture.audits[0]!.findings[0]!.id, status: "resolved" });
      }),
    );
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "해결하고 다음 미검토 항목" }));
    const list = within(screen.getByRole("navigation", { name: "점검 항목" }));
    await user.click(list.getByRole("button", { name: /순차적 가격 공개/ }));
    finish();
    const filters = within(screen.getByRole("group", { name: "점검 항목 필터" }));
    await waitFor(() =>
      expect(filters.getByRole("button", { name: "해결됨 2" })).toBeInTheDocument(),
    );
    expect(list.getByRole("button", { name: /순차적 가격 공개/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(filters.getByRole("button", { name: "전체 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("selects an item from the master list and updates its screen and evidence", async () => {
    const user = userEvent.setup();
    const fixture = structuredClone(dashboardFixture);
    const audit = fixture.audits[0]!;
    const target = { ...audit.findings[1]!, id: "extra-finding", title: "추가 점검 항목" };
    audit.findings.push(target);
    server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
    renderPage();
    const list = await screen.findByRole("navigation", { name: "점검 항목" });
    const item = within(list).getByRole("button", { name: /추가 점검 항목/ });
    await user.click(item);
    expect(item).toHaveAttribute("aria-current", "true");
    expect(within(list).getAllByRole("heading", { level: 3 })).toHaveLength(4);
    const detail = screen.getByRole("region", { name: "선택한 항목 검토" });
    expect(within(detail).getByRole("heading", { name: target.title })).toBeInTheDocument();
    expect(within(detail).getByText(target.recommendation)).toBeInTheDocument();
    const selectedScreen = audit.screens.find(
      (item) => item.id === (target.bbox?.screenId ?? target.screenIds[0]),
    )!;
    const preview = within(detail).getByRole<HTMLImageElement>("img", {
      name: /캡처 화면 미리보기/,
    });
    expect(new URL(preview.src).pathname).toBe(selectedScreen.imageUrl);
  });

  it("shows incomplete analysis separately from zero findings", async () => {
    const fixture = structuredClone(dashboardFixture);
    fixture.audits[0]!.findings = [];
    fixture.audits[0]!.analysisSummary = {
      complete: false,
      reviewRequired: true,
      unsupportedRules: ["DA-01", "DA-02"],
      regression: {
        comparisonStatus: "incomplete",
        pendingCount: 1,
        resolvedRatio: null,
        limitations: ["두 회차의 화면 구성이 다릅니다."],
      },
      supportedRules: ["DA-03", "DA-04", "DA-07", "DA-12", "DA-15"],
      analyzedScreenCount: 2,
      limitations: ["일부 Figma 화면을 가져오지 못했습니다."],
      ruleAssessments: [
        { ruleId: "DA-15", status: "insufficient_evidence", reasons: ["최종 가격 화면 누락"] },
      ],
    };
    server.use(http.get("*/api/v1/dashboard/summary", () => HttpResponse.json(fixture)));
    renderPage();
    expect(await screen.findByRole("region", { name: "분석 범위" })).toBeInTheDocument();
    expect(screen.getByText("검사 범위와 추가 확인 사항")).toBeInTheDocument();
    expect(screen.getByText("일부 Figma 화면을 가져오지 못했습니다.")).toBeInTheDocument();
    expect(screen.getByText(/DA-15: 근거 부족/)).toBeVisible();
    expect(screen.getByText(/검토 후보 · 이미지 중심/)).toBeVisible();
    expect(screen.getByText(/미지원 규칙 2개: DA-01, DA-02/)).toBeVisible();
    expect(screen.getByText(/재검증 판정 보류 · 해결률을 계산하지 않았습니다/)).toBeVisible();
    expect(screen.getByText("두 회차의 화면 구성이 다릅니다.")).toBeVisible();
  });

  it("loads the active audit without listing other audits", async () => {
    renderPage();

    expect(screen.getByLabelText("상세 결과 불러오는 중")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "보험 가입 흐름 v1" })).toBeInTheDocument();
    const metrics = screen.getByRole("region", { name: "진단 현황" });
    expect(
      within(metrics).getByText("전체 검토 후보").closest(".overview-metric"),
    ).toHaveTextContent("3건");
    expect(within(metrics).getByText("검토 필요").closest(".overview-metric")).toHaveTextContent(
      "2건",
    );
    expect(within(metrics).getByText("해결 표시").closest(".overview-metric")).toHaveTextContent(
      "1/ 3건",
    );
    expect(metrics).toHaveTextContent("검토자가 지정한 상태 기준");
    // 첫 진입에서 미리보기는 화면 1이 아니라 선택된 탐지 항목(DA-04)이 있는
    // 화면이어야 한다. 둘이 어긋나면 위치 강조가 보이지 않는다.
    expect(screen.getByRole("img", { name: "옵션 선택 캡처 화면 미리보기" })).toHaveAttribute(
      "src",
      expect.stringContaining("/mock/option.png"),
    );

    expect(screen.queryByText("적금 가입 흐름 v2")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "진단 관리" })).toHaveAttribute("href", "/app/audits");
  });

  it("opens the audit identified in the detail URL", async () => {
    renderPage("/app/overview?audit=audit-savings-v2");
    const completedHeading = await screen.findByRole("heading", { name: "적금 가입 흐름 v2" });
    expect(completedHeading).toBeInTheDocument();
    expect(completedHeading.previousElementSibling).toHaveTextContent("완료");
    const metrics = screen.getByRole("region", { name: "진단 현황" });
    expect(within(metrics).getByText("해결 표시").closest(".overview-metric")).toHaveTextContent(
      "0/ 0건",
    );
    expect(metrics).not.toHaveTextContent("100%");
    expect(screen.getByText("탐지된 항목이 없습니다")).toBeInTheDocument();
    // 탐지 항목이 없으면 기존대로 첫 화면을 보여준다.
    expect(screen.getByRole("img", { name: "상품 안내 캡처 화면 미리보기" })).toHaveAttribute(
      "src",
      expect.stringContaining("/mock/savings.png"),
    );
  });

  it("shows recommendation by default, opens flow and metadata, and navigates findings", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole("heading", { name: "보험 가입 흐름 v1" });

    const previewImage = screen.getByRole("img", { name: /캡처 화면 미리보기/ });
    const previewViewport = screen.getByTestId("screen-preview-viewport");

    expect(previewViewport).toHaveClass("overflow-auto", "scrollbar-hidden", "cursor-grab");
    fireEvent.pointerDown(previewViewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    expect(previewViewport).toHaveClass("cursor-grabbing");
    fireEvent.pointerUp(previewViewport, { pointerId: 1 });
    fireEvent.pointerDown(previewViewport, {
      button: -1,
      clientX: 100,
      clientY: 100,
      pointerId: 2,
      pointerType: "touch",
    });
    expect(previewViewport).toHaveClass("cursor-grabbing");
    fireEvent.pointerUp(previewViewport, { pointerId: 2, pointerType: "touch" });
    await user.click(screen.getByRole("button", { name: "확대" }));
    expect(previewViewport).toHaveClass("overflow-auto");
    expect(previewViewport).toHaveClass("cursor-grab");
    expect(screen.getByLabelText("미리보기 배율")).not.toHaveTextContent("100%");
    expect(previewImage.parentElement).not.toHaveStyle({ transform: "scale(1.2)" });
    fireEvent.pointerDown(previewViewport, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(previewViewport, { clientX: 70, clientY: 60, pointerId: 1 });
    expect(previewViewport.scrollLeft).toBe(30);
    expect(previewViewport.scrollTop).toBe(40);
    expect(previewViewport).toHaveClass("cursor-grabbing");
    fireEvent.pointerUp(previewViewport, { pointerId: 1 });
    expect(previewViewport).toHaveClass("cursor-grab");
    await user.click(screen.getByRole("button", { name: "화면 전체 보기" }));
    expect(previewViewport).toHaveClass("overflow-auto", "scrollbar-hidden");
    expect(screen.getByLabelText("미리보기 배율")).toHaveTextContent("100%");

    await user.click(screen.getByRole("button", { name: /전체 흐름 보기/ }));
    expect(screen.getByRole("dialog", { name: "전체 가입 흐름" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "닫기" }));

    expect(screen.getByRole("heading", { name: "개선 권고안" })).toBeInTheDocument();
    expect(screen.getByText(/추가 비용이 발생하는 옵션의 기본 선택을 해제/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "탐지 메타데이터" }));
    expect(screen.getByText(/신뢰도 94%/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음 탐지 항목" }));
    expect(
      within(screen.getByRole("navigation", { name: "점검 항목" })).getByRole("button", {
        name: /순차적 가격 공개/,
      }),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("steps through every finding with the detail arrows", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(await screen.findByRole("heading", { name: "보험 가입 흐름 v1" })).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "다음 탐지 항목" }));
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    // 처음에서 이전으로 가면 마지막으로 돌아온다.
    await user.click(screen.getByRole("button", { name: "이전 탐지 항목" }));
    await user.click(screen.getByRole("button", { name: "이전 탐지 항목" }));
    expect(screen.getByText("3 / 3")).toBeInTheDocument();
  });
});

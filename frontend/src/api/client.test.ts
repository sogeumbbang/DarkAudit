describe("warmUpApi", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.example.test");
    vi.stubEnv("VITE_USE_MOCKS", "false");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("warms the deployed API once and reuses the fresh result", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"status":"ok"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { warmUpApi } = await import("@/api/client");

    await warmUpApi();
    await warmUpApi();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/health",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("retries a transient cold-start connection failure", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response('{"status":"ok"}', { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { warmUpApi } = await import("@/api/client");

    const warmup = warmUpApi();
    await vi.advanceTimersByTimeAsync(2_000);
    await warmup;

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("workspace authentication", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.workspace.test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("bootstraps once for concurrent requests and reuses the workspace after reload", async () => {
    const token = "a".repeat(43);
    const fetchMock = vi.fn(
      async (url: string) =>
        new Response(JSON.stringify(url.endsWith("/sessions") ? { token } : { ok: true }), {
          status: url.endsWith("/sessions") ? 201 : 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { apiRequest } = await import("@/api/client");
    await Promise.all([
      apiRequest("/api/v1/dashboard/summary"),
      apiRequest("/api/v1/dashboard/summary"),
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/sessions"))).toHaveLength(1);
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://api.workspace.test/api/v1/dashboard/summary",
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
    const headers = (fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1]
      .headers as Headers;
    expect(headers.get("Authorization")).toBe(`Bearer ${token}`);
    vi.resetModules();
    await (await import("@/api/client")).apiRequest("/api/v1/dashboard/summary");
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/sessions"))).toHaveLength(1);
  });

  it("does not replace an invalid workspace and silently hide existing audits", async () => {
    localStorage.setItem("darkaudit.workspace:https://api.workspace.test", "a".repeat(43));
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"detail":"작업공간 인증 실패"}', { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { apiRequest } = await import("@/api/client");
    await expect(apiRequest("/api/v1/dashboard/summary")).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("darkaudit.workspace:https://api.workspace.test")).toBe(
      "a".repeat(43),
    );
  });

  it("announces a rejected workspace and resets it only on request", async () => {
    localStorage.setItem("darkaudit.workspace:https://api.workspace.test", "a".repeat(43));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 401 })));
    const { apiRequest, resetWorkspace, WORKSPACE_REJECTED_EVENT } = await import("@/api/client");
    const listener = vi.fn();
    window.addEventListener(WORKSPACE_REJECTED_EVENT, listener);
    await expect(apiRequest("/api/v1/dashboard/summary")).rejects.toMatchObject({ status: 401 });
    window.removeEventListener(WORKSPACE_REJECTED_EVENT, listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("darkaudit.workspace:https://api.workspace.test")).not.toBeNull();
    resetWorkspace();
    expect(localStorage.getItem("darkaudit.workspace:https://api.workspace.test")).toBeNull();
  });
});

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

describe("public workspace", () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    vi.stubEnv("VITE_API_BASE_URL", "https://api.workspace.test");
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("reads the shared records across fresh browsers without creating sessions", async () => {
    const summary = { activeAuditId: "audit-1", audits: [{ id: "audit-1" }] };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(summary)));
    vi.stubGlobal("fetch", fetchMock);
    const { apiRequest } = await import("@/api/client");
    expect(await apiRequest("/api/v1/dashboard/summary")).toEqual(summary);
    localStorage.clear();
    vi.resetModules();
    expect(await (await import("@/api/client")).apiRequest("/api/v1/dashboard/summary")).toEqual(
      summary,
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [url, init] of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      expect(url).toBe("https://api.workspace.test/api/v1/dashboard/summary");
      expect((init.headers as Headers).has("Authorization")).toBe(false);
    }
  });

  it("does not depend on an old token or browser storage access", async () => {
    localStorage.setItem("darkaudit.workspace:https://api.workspace.test", "a".repeat(43));
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    const fetchMock = vi.fn(async () => new Response('{"audits":[]}'));
    vi.stubGlobal("fetch", fetchMock);
    const { apiRequest } = await import("@/api/client");
    await expect(apiRequest("/api/v1/dashboard/summary")).resolves.toEqual({ audits: [] });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

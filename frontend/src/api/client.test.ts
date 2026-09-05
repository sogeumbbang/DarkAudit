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

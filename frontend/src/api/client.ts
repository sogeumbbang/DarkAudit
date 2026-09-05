// Render 서비스명이 그대로 호스트가 된다. 오타가 나도 빌드는 통과하고, 배포된
// 앱만 죽은 주소를 향한 채 warmUpApi 가 120초를 헛돌다 실패한다.
// 값을 바꿀 때는 실제 /health 응답을 확인할 것.
const DEPLOYED_API_BASE_URL = "https://darkaudit.onrender.com";
const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE_URL = (
  configuredApiBaseUrl || (import.meta.env.PROD ? DEPLOYED_API_BASE_URL : "")
).replace(/\/$/, "");
const DEFAULT_TIMEOUT_MS = 30_000;
const API_WARMUP_TIMEOUT_MS = 120_000;
const API_WARMUP_FRESH_MS = 10 * 60_000;
let warmupPromise: Promise<void> | undefined;
let lastReadyAt = 0;

export type ApiErrorBody = {
  message?: string;
  detail?: string | Array<{ msg: string; loc?: Array<string | number> }>;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorBody,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function resolveApiUrl(value: string) {
  return value.startsWith("/") && API_BASE_URL ? `${API_BASE_URL}${value}` : value;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));
}

async function probeApiUntilReady() {
  const deadline = Date.now() + API_WARMUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const remaining = deadline - Date.now();
    const timeoutId = window.setTimeout(() => controller.abort(), Math.min(45_000, remaining));
    try {
      const response = await fetch(resolveApiUrl("/health"), {
        cache: "no-store",
        signal: controller.signal,
      });
      if (response.ok) {
        lastReadyAt = Date.now();
        return;
      }
    } catch {
      // Render가 슬립 또는 재배포 중이면 연결 실패/502/timeout이 번갈아 날 수 있다.
      // 전체 준비 제한 안에서 health를 다시 호출해 실제 생성 POST는 중복하지 않는다.
    } finally {
      window.clearTimeout(timeoutId);
    }
    if (Date.now() < deadline) await wait(Math.min(2_000, deadline - Date.now()));
  }
  throw new ApiError("서버를 시작하는 데 시간이 걸리고 있습니다. 잠시 후 다시 시도해주세요.", 503);
}

export function warmUpApi() {
  if (!API_BASE_URL || import.meta.env.VITE_USE_MOCKS === "true") return Promise.resolve();
  if (Date.now() - lastReadyAt < API_WARMUP_FRESH_MS) return Promise.resolve();
  if (!warmupPromise) {
    warmupPromise = probeApiUntilReady().finally(() => {
      warmupPromise = undefined;
    });
  }
  return warmupPromise;
}

function errorMessage(body?: ApiErrorBody) {
  if (body?.message) return body.message;
  if (typeof body?.detail === "string") return body.detail;
  if (Array.isArray(body?.detail)) return body.detail.map((item) => item.msg).join(", ");
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.";
}

export async function apiRequest<T>(
  path: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(
    () => controller.abort(),
    init?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const isFormData = init?.body instanceof FormData;

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      signal: init?.signal ?? controller.signal,
      headers: {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...init?.headers,
      },
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => undefined)) as ApiErrorBody | undefined;
      throw new ApiError(errorMessage(body), response.status, body);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("요청 시간이 초과되었습니다. 다시 시도해주세요.", 408);
    }
    throw new ApiError("서버에 연결할 수 없습니다. 네트워크 상태를 확인해주세요.", 0);
  } finally {
    window.clearTimeout(timeoutId);
  }
}

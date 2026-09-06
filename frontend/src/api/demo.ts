import { z } from "zod";

import { apiRequest, resolveApiUrl, warmUpApi } from "@/api/client";

const demoInputsSchema = z.object({
  website: z.object({ url: z.string().url(), available: z.boolean() }),
  figma: z.object({
    fileUrl: z.string(),
    available: z.boolean(),
    reason: z.string().nullable(),
  }),
  android: z.object({
    downloadUrl: z.string().url(),
    available: z.boolean(),
    reason: z.string().nullable(),
  }),
});

export async function getDemoInputs() {
  await warmUpApi();
  return demoInputsSchema.parse(await apiRequest<unknown>("/api/v1/demo-inputs"));
}

export async function getDemoApk(url: string) {
  const response = await fetch(resolveApiUrl(url), { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error("데모 APK를 불러오지 못했습니다. 다시 시도해주세요.");
  const bytes = await response.arrayBuffer();
  const signature = new Uint8Array(bytes, 0, Math.min(4, bytes.byteLength));
  if (
    signature.length < 4 ||
    signature[0] !== 0x50 ||
    signature[1] !== 0x4b ||
    signature[2] !== 3 ||
    signature[3] !== 4
  ) {
    throw new Error("데모 APK 파일을 확인할 수 없습니다. 다시 시도해주세요.");
  }
  return new File([bytes], "darkaudit-demo.apk", {
    type: "application/vnd.android.package-archive",
  });
}

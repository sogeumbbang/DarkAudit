import { z } from "zod";

import { apiRequest, resolveApiUrl, warmUpApi } from "@/api/client";
import type { UploadAuditScreen } from "@/entities/audit/types";

// Resolve paths against the browser-facing API URL, not the proxy HTTP origin.
const demoAssetUrl = z
  .string()
  .startsWith("/demo/")
  .transform((path) => new URL(resolveApiUrl(path), window.location.origin).href);

const demoInputsSchema = z.object({
  cases: z
    .array(
      z.object({
        id: z.enum(["pet", "travel", "credit"]),
        name: z.string(),
        productType: z.enum(["insurance", "deposit", "loan", "investment", "other"]),
        variants: z.array(
          z.object({
            id: z.enum(["risky", "partial", "revised"]),
            label: z.string(),
            websiteUrl: demoAssetUrl,
            expectedRules: z.array(z.string()),
            screens: z
              .array(z.object({ fileName: z.string(), flowStep: z.string(), url: demoAssetUrl }))
              .min(1)
              .max(6),
          }),
        ),
      }),
    )
    .default([]),
  website: z.object({ url: demoAssetUrl, available: z.boolean() }),
  figma: z.object({
    variants: z
      .array(
        z.object({
          id: z.enum(["risky", "partial", "revised"]),
          label: z.string(),
          flowName: z.string(),
          available: z.boolean(),
        }),
      )
      .default([]),
    fileUrl: z.string(),
    selectionMode: z.enum(["prototype-flow", "all-frames"]).default("all-frames"),
    flowName: z.string().nullable().optional(),
    available: z.boolean(),
    reason: z.string().nullable(),
  }),
  android: z.object({
    variants: z
      .array(
        z.object({
          id: z.enum(["risky", "partial", "revised"]),
          label: z.string(),
          downloadUrl: demoAssetUrl,
          available: z.boolean(),
        }),
      )
      .default([]),
    downloadUrl: demoAssetUrl,
    available: z.boolean(),
    reason: z.string().nullable(),
  }),
});

export type DemoCase = z.infer<typeof demoInputsSchema>["cases"][number];
export const demoVariantLabels = {
  risky: "문제 포함 원본",
  partial: "일부 수정본",
  revised: "전체 개선본",
};
export const demoGoal =
  "다음 버튼으로 6개 화면의 최종 이용료까지 확인하세요. 거절 버튼이 있으면 거절하고 계속하세요. 실제 계약이나 결제는 하지 마세요.";

export async function getDemoScreens(
  variant: DemoCase["variants"][number],
): Promise<UploadAuditScreen[]> {
  return Promise.all(
    variant.screens.map(async (screen, index) => {
      // A preview <img> may have cached the file without CORS headers; bypass it.
      const response = await fetch(screen.url, {
        cache: "no-store",
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) throw new Error("데모 이미지를 불러오지 못했습니다. 다시 시도해 주세요.");
      const bytes = new Uint8Array(await response.arrayBuffer());
      const signature = [137, 80, 78, 71, 13, 10, 26, 10];
      if (!signature.every((value, i) => bytes[i] === value))
        throw new Error("데모 이미지 파일이 올바르지 않습니다.");
      return {
        id: `demo-${index + 1}`,
        flowStep: screen.flowStep,
        file: new File([bytes], screen.fileName, { type: "image/png" }),
      };
    }),
  );
}

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

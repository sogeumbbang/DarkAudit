import { z } from "zod";

import { apiRequest, warmUpApi } from "@/api/client";

export type ChatRole = "user" | "assistant";
export type ChatTurn = { role: ChatRole; content: string };

const pointSchema = z.object({ text: z.string(), citations: z.array(z.number()) });

const chatResponseSchema = z.object({
  answer: z.string(),
  structured: z.object({
    inScope: z.boolean(),
    summary: z.string(),
    summaryCitations: z.array(z.number()),
    relatedRules: z.array(z.object({ ruleId: z.string(), name: z.string() })),
    keyPoints: z.array(pointSchema),
    checklist: z.array(pointSchema),
  }),
  sources: z.array(
    z.object({
      index: z.number(),
      title: z.string(),
      section: z.string(),
      sourceFile: z.string(),
      excerpt: z.string(),
    }),
  ),
});

export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type ChatSource = ChatResponse["sources"][number];
export type ChatStructured = ChatResponse["structured"];
export type ChatPoint = ChatStructured["keyPoints"][number];

// 답변 생성 모델이 느릴 수 있어 기본 30초보다 넉넉히 기다린다.
const CHAT_TIMEOUT_MS = 90_000;

export async function askChatbot(message: string, history: ChatTurn[]) {
  await warmUpApi();
  return chatResponseSchema.parse(
    await apiRequest<unknown>("/api/v1/chat", {
      method: "POST",
      body: JSON.stringify({ message, history }),
      timeoutMs: CHAT_TIMEOUT_MS,
    }),
  );
}

import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";

import { ChatbotWidget } from "./ChatbotWidget";
import { server } from "@/mocks/server";

type ChatBody = { message: string; history: Array<{ role: string; content: string }> };

function captureChat(answer = (message: string) => `${message} 답변 [1]`) {
  const requests: ChatBody[] = [];
  server.use(
    http.post("*/api/v1/chat", async ({ request }) => {
      const body = (await request.json()) as ChatBody;
      requests.push(body);
      return HttpResponse.json({
        answer: answer(body.message),
        sources: [
          {
            index: 1,
            title: "가이드라인",
            section: "압박형 > ② 반복간섭",
            sourceFile: "guideline.pdf",
            excerpt: "동일한 요구를 2회 이상 하는 경우",
          },
        ],
      });
    }),
  );
  return requests;
}

async function openChat() {
  const user = userEvent.setup();
  render(<ChatbotWidget />);
  await user.click(screen.getByRole("button", { name: "다크패턴 챗봇" }));
  return user;
}

it("asks a question and shows the answer with its sources", async () => {
  const requests = captureChat();
  const user = await openChat();
  await user.type(screen.getByRole("textbox", { name: "질문" }), "반복간섭 기준은?{Enter}");
  expect(await screen.findByText("반복간섭 기준은? 답변 [1]")).toBeInTheDocument();
  expect(requests).toEqual([{ message: "반복간섭 기준은?", history: [] }]);
  expect(screen.getByRole("textbox", { name: "질문" })).toHaveValue("");
  await user.click(screen.getByText("근거 1건"));
  expect(screen.getByText("[1] 압박형 > ② 반복간섭")).toBeVisible();
});

it("sends previous turns as history for follow-up questions", async () => {
  const requests = captureChat();
  const user = await openChat();
  await user.click(screen.getByRole("button", { name: "특정옵션 사전선택이 뭐야?" }));
  await screen.findByText("특정옵션 사전선택이 뭐야? 답변 [1]");
  await user.type(screen.getByRole("textbox", { name: "질문" }), "예시도 알려줘");
  await user.click(screen.getByRole("button", { name: "보내기" }));
  await screen.findByText("예시도 알려줘 답변 [1]");
  expect(requests[1]).toEqual({
    message: "예시도 알려줘",
    history: [
      { role: "user", content: "특정옵션 사전선택이 뭐야?" },
      { role: "assistant", content: "특정옵션 사전선택이 뭐야? 답변 [1]" },
    ],
  });
});

it("restores the question and shows an error when the request fails", async () => {
  server.use(
    http.post("*/api/v1/chat", () =>
      HttpResponse.json({ detail: "답변을 생성하지 못했습니다." }, { status: 502 }),
    ),
  );
  const user = await openChat();
  await user.type(screen.getByRole("textbox", { name: "질문" }), "감각조작이 뭐야?{Enter}");
  expect(await screen.findByRole("alert")).toHaveTextContent("답변을 생성하지 못했습니다.");
  expect(screen.getByRole("textbox", { name: "질문" })).toHaveValue("감각조작이 뭐야?");
  const panel = screen.getByRole("region", { name: "다크패턴 챗봇" });
  expect(within(panel).queryByText("감각조작이 뭐야?", { selector: "p" })).not.toBeInTheDocument();
});

it("closes the panel", async () => {
  const user = await openChat();
  await user.click(screen.getByRole("button", { name: "챗봇 닫기" }));
  expect(screen.queryByRole("region", { name: "다크패턴 챗봇" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "다크패턴 챗봇" })).toBeInTheDocument();
});

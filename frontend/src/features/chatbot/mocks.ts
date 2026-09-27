import { delay, http, HttpResponse } from "msw";

export const chatbotHandlers = [
  http.post("*/api/v1/chat", async ({ request }) => {
    const { message } = (await request.json()) as { message: string };
    await delay(300);
    return HttpResponse.json({
      answer: `목업 응답입니다. "${message}"에 대한 가이드라인 근거를 확인하세요. [1]`,
      structured: {
        inScope: true,
        summary: `목업 응답입니다. "${message}"에 대한 가이드라인 근거를 확인하세요.`,
        summaryCitations: [1],
        relatedRules: [{ ruleId: "DA-04", name: "특정옵션의 사전선택" }],
        keyPoints: [
          {
            text: "초기 렌더 상태에서 유료·선택 옵션이 체크되어 있으면 해당할 수 있습니다.",
            citations: [1],
          },
        ],
        checklist: [
          { text: "선택 항목의 기본값을 미선택으로 두세요.", citations: [1] },
          { text: "여러 항목이면 전체선택·전체해제 버튼을 함께 제공하세요.", citations: [1] },
        ],
      },
      sources: [
        {
          index: 1,
          title: "온라인 금융상품 판매 관련 다크패턴 가이드라인 (별첨)",
          section: "오도형 > ④ 특정옵션의 사전선택",
          sourceFile: "251224[별첨] 온라인 금융상품 판매 관련 다크패턴 가이드라인.pdf",
          excerpt:
            "사업자에게 유리한 선택사항(옵션)을 미리 선택해놓고 금융소비자가 이를 지나치게 하거나 그대로 수용하도록 유도하는 행위",
        },
      ],
    });
  }),
];

// 챗봇은 진단 기능과 독립된 부가 기능이라 빌드 환경변수로 끌 수 있다.
// 끄기/제거 절차는 docs/chatbot.md 참고.
export const chatbotEnabled = () => import.meta.env.VITE_CHATBOT_ENABLED !== "false";

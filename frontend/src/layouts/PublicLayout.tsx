import { Outlet } from "react-router-dom";
import { ChatbotWidget } from "@/features/chatbot/ChatbotWidget";

export function PublicLayout() {
  return (
    <>
      <Outlet />
      <ChatbotWidget compact />
    </>
  );
}

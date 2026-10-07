import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { ApiError } from "@/api/client";
import { ChatAnswerCard } from "@/features/chatbot/ChatAnswerCard";
import {
  askChatbot,
  type ChatSource,
  type ChatStructured,
  type ChatTurn,
} from "@/features/chatbot/api";
import { chatbotEnabled } from "@/features/chatbot/config";
import { cn } from "@/lib/cn";
import "./chatbot.css";

type Message = ChatTurn & { id: number; sources?: ChatSource[]; structured?: ChatStructured };

const HISTORY_TURNS = 6;
const SUGGESTIONS = [
  "DA-03은 어떤 기준으로 탐지해?",
  "사전선택된 옵션은 어떻게 고쳐야 해?",
  "반복간섭은 몇 번부터 해당돼?",
];

export function ChatbotWidget({ compact = false }: { compact?: boolean }) {
  return chatbotEnabled() ? <ChatbotPanel compact={compact} /> : null;
}

function ChatbotPanel({ compact }: { compact: boolean }) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, pending]);

  async function send(text: string) {
    const question = text.trim();
    if (!question || pending) return;
    const history = messages.slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role: "user", content: question },
    ]);
    setDraft("");
    setError(null);
    setPending(true);
    try {
      const result = await askChatbot(question, history);
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          role: "assistant",
          content: result.answer,
          sources: result.sources,
          structured: result.structured,
        },
      ]);
    } catch (caught) {
      // 실패한 질문은 대화에서 빼고 입력창에 되돌려 다시 보낼 수 있게 한다.
      setMessages((current) => current.slice(0, -1));
      setDraft(question);
      setError(
        caught instanceof ApiError ? caught.message : "답변을 받지 못했습니다. 다시 시도해주세요.",
      );
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <button
        aria-label="다크패턴 챗봇"
        className={cn(
          "workspace-chat-launcher fixed bottom-4 right-4 z-30 flex size-12 items-center justify-center gap-2 bg-brand-600 text-sm font-semibold text-white shadow-sm hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400",
          compact ? "rounded-full" : "rounded-control sm:h-auto sm:w-auto sm:px-5 sm:py-3.5",
        )}
        onClick={() => setOpen(true)}
      >
        <MessageCircle aria-hidden="true" size={19} />
        {!compact && <span className="hidden sm:inline">다크패턴 챗봇</span>}
      </button>
    );
  }

  return (
    <section
      aria-label="다크패턴 챗봇"
      className="workspace-chat fixed inset-x-4 bottom-4 z-30 flex max-h-[min(640px,calc(100vh-2rem))] flex-col rounded-card border border-border bg-surface shadow-card sm:left-auto sm:right-5 sm:w-[440px]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-bold">다크패턴 가이드 챗봇</h2>
          <p className="mt-1 text-xs text-muted">
            금융위 다크패턴 가이드라인(2025.12)과 DarkAudit 규칙(DA-01~15)을 근거로 답합니다.
          </p>
        </div>
        {/* The 44px hit area is offset so the icon sits on the title line and the right edge. */}
        <button
          aria-label="챗봇 닫기"
          className="-my-2 -mr-3 flex items-center justify-center rounded-control text-muted hover:bg-black/5"
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </button>
      </header>

      <div
        aria-live="polite"
        className="workspace-chat-messages min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
        ref={listRef}
      >
        {messages.length === 0 && (
          <div>
            <p className="text-sm leading-6 text-muted">
              금융 다크패턴 유형, 판단 기준, 적용대상, 시행시기 등을 물어보세요.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  className="rounded-control border border-border px-3 py-2 text-xs text-text hover:bg-brand-50"
                  key={suggestion}
                  onClick={() => void send(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((message) => (
          <div
            className={cn("flex", message.role === "user" ? "justify-end" : "justify-start")}
            key={message.id}
          >
            <div
              className={cn(
                "rounded-card px-4 py-3 text-sm leading-6 break-words",
                message.role === "user"
                  ? "max-w-[85%] bg-brand-600 text-white"
                  : "w-full border border-border bg-background text-text",
              )}
            >
              {message.structured ? (
                <ChatAnswerCard sources={message.sources ?? []} structured={message.structured} />
              ) : (
                <p className="whitespace-pre-wrap">{message.content}</p>
              )}
            </div>
          </div>
        ))}
        {pending && (
          <p className="text-sm text-muted" role="status">
            가이드라인에서 답을 찾는 중…
          </p>
        )}
      </div>

      <form
        className="border-t border-border px-4 py-3 sm:px-5"
        onSubmit={(event) => {
          event.preventDefault();
          void send(draft);
        }}
      >
        {error && (
          <p className="mb-2 text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex items-end gap-2">
          <label className="sr-only" htmlFor={inputId}>
            질문
          </label>
          <textarea
            className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-control border border-border bg-surface px-3 py-2 text-sm leading-6 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            id={inputId}
            maxLength={1000}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(draft);
              }
            }}
            placeholder="다크패턴에 대해 물어보세요"
            rows={1}
            value={draft}
          />
          <button
            aria-label="보내기"
            className="flex items-center justify-center rounded-control bg-brand-600 p-2.5 text-white hover:bg-brand-500 disabled:opacity-50"
            disabled={!draft.trim() || pending}
            type="submit"
          >
            <Send size={17} />
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-4 text-muted">
          문서 기반 안내이며 법률 자문이 아닙니다. 최종 판단은 관련 부서 검토가 필요합니다.
        </p>
      </form>
    </section>
  );
}

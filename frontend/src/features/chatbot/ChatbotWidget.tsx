import { MessageCircle, Send, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { askChatbot, type ChatSource, type ChatTurn } from "@/api/chat";
import { ApiError } from "@/api/client";
import { cn } from "@/lib/cn";

type Message = ChatTurn & { id: number; sources?: ChatSource[] };

const HISTORY_TURNS = 6;
const SUGGESTIONS = [
  "특정옵션 사전선택이 뭐야?",
  "반복간섭은 몇 번부터 해당돼?",
  "가이드라인은 언제부터 시행돼?",
];

// 모델이 마크다운 강조(**)를 섞어도 일반 텍스트로 보이게 한다.
const plain = (text: string) => text.replace(/\*\*/g, "");

function SourceList({ sources }: { sources: ChatSource[] }) {
  return (
    <details className="mt-2 text-xs text-muted">
      <summary className="cursor-pointer font-semibold">근거 {sources.length}건</summary>
      <ol className="mt-2 space-y-2">
        {sources.map((source) => (
          <li className="rounded-control bg-background p-2 leading-5" key={source.index}>
            <p className="font-semibold text-text">
              [{source.index}] {source.section}
            </p>
            <p className="mt-0.5">{source.title}</p>
            <p className="mt-1">{source.excerpt}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ChatbotWidget() {
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
        className="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-brand-600 px-5 py-3.5 text-sm font-semibold text-white shadow-lg hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        onClick={() => setOpen(true)}
      >
        <MessageCircle aria-hidden="true" size={19} />
        다크패턴 챗봇
      </button>
    );
  }

  return (
    <section
      aria-label="다크패턴 챗봇"
      className="fixed inset-x-4 bottom-4 z-30 flex max-h-[min(640px,calc(100vh-2rem))] flex-col rounded-card border border-border bg-surface shadow-2xl sm:left-auto sm:right-5 sm:w-[400px]"
    >
      <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="text-sm font-bold">다크패턴 가이드 챗봇</h2>
          <p className="mt-1 text-xs text-muted">
            금융위원회 다크패턴 가이드라인(2025.12) 문서를 근거로 답합니다.
          </p>
        </div>
        <button
          aria-label="챗봇 닫기"
          className="rounded-control p-1.5 text-muted hover:bg-black/5"
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </button>
      </header>

      <div
        aria-live="polite"
        className="min-h-48 flex-1 space-y-4 overflow-y-auto px-5 py-4"
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
                  className="rounded-full border border-border px-3 py-1.5 text-xs text-text hover:bg-brand-50"
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
                "max-w-[88%] rounded-card px-4 py-3 text-sm leading-6",
                message.role === "user"
                  ? "bg-brand-600 text-white"
                  : "border border-border bg-background text-text",
              )}
            >
              <p className="whitespace-pre-wrap break-words">{plain(message.content)}</p>
              {message.sources && message.sources.length > 0 && (
                <SourceList sources={message.sources} />
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
        className="border-t border-border px-4 py-3"
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
            className="max-h-32 min-h-10 flex-1 resize-none rounded-control border border-border bg-surface px-3 py-2 text-sm leading-6 outline-none focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
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
            className="rounded-control bg-brand-600 p-2.5 text-white hover:bg-brand-500 disabled:opacity-50"
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

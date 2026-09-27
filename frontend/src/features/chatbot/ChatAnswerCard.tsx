import { CircleCheck } from "lucide-react";

import type { ChatPoint, ChatSource, ChatStructured } from "@/features/chatbot/api";

function Citations({ citations }: { citations: number[] }) {
  if (citations.length === 0) return null;
  return (
    <span className="ml-1 inline-flex gap-0.5 align-middle">
      {citations.map((citation) => (
        <span
          aria-label={`근거 ${citation}`}
          className="rounded bg-brand-100 px-1 text-[10px] font-semibold leading-4 text-brand-700"
          key={citation}
        >
          {citation}
        </span>
      ))}
    </span>
  );
}

function Section({
  title,
  points,
  checklist = false,
}: {
  title: string;
  points: ChatPoint[];
  checklist?: boolean;
}) {
  if (points.length === 0) return null;
  return (
    <section className="mt-4">
      <h4 className="text-xs font-bold text-muted">{title}</h4>
      <ul className="mt-2 space-y-1.5">
        {points.map((point, index) => (
          <li className="flex gap-2" key={index}>
            {checklist ? (
              <CircleCheck aria-hidden="true" className="mt-1 shrink-0 text-brand-600" size={14} />
            ) : (
              <span aria-hidden="true" className="mt-2.5 size-1 shrink-0 rounded-full bg-muted" />
            )}
            <span>
              {point.text}
              <Citations citations={point.citations} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SourceList({ sources }: { sources: ChatSource[] }) {
  if (sources.length === 0) return null;
  return (
    <details className="mt-4 border-t border-border pt-3 text-xs text-muted">
      <summary className="cursor-pointer font-semibold">근거 {sources.length}건</summary>
      <ol className="mt-2 space-y-2">
        {sources.map((source) => (
          <li className="rounded-control bg-surface p-2 leading-5" key={source.index}>
            <p className="font-semibold text-text">
              <span className="mr-1 rounded bg-brand-100 px-1 text-[10px] text-brand-700">
                {source.index}
              </span>
              {source.section}
            </p>
            <p className="mt-0.5">{source.title}</p>
            <p className="mt-1">{source.excerpt}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ChatAnswerCard({
  structured,
  sources,
}: {
  structured: ChatStructured;
  sources: ChatSource[];
}) {
  return (
    <div>
      <p className="font-medium text-text">
        {structured.summary}
        <Citations citations={structured.summaryCitations} />
      </p>
      {structured.relatedRules.length > 0 && (
        <ul aria-label="관련 규칙" className="mt-3 flex flex-wrap gap-1.5">
          {structured.relatedRules.map((rule) => (
            <li
              className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700 ring-1 ring-inset ring-brand-100"
              key={rule.ruleId}
            >
              {rule.ruleId} {rule.name}
            </li>
          ))}
        </ul>
      )}
      <Section points={structured.keyPoints} title="핵심 내용" />
      <Section checklist points={structured.checklist} title="구현 체크리스트" />
      <SourceList sources={sources} />
    </div>
  );
}

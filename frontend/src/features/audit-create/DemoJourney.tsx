import { cn } from "@/lib/cn";

export function DemoJourney({ step }: { step: 1 | 2 | 3 }) {
  return (
    <ol aria-label="데모 진행 순서" className="my-5 grid grid-cols-3 gap-2 text-center text-xs">
      {["원본 검사", "수정본 검사", "전후 비교"].map((label, index) => (
        <li
          key={label}
          aria-current={step === index + 1 ? "step" : undefined}
          className={cn(
            "rounded-control px-2 py-3",
            step === index + 1 ? "bg-brand-600 font-semibold text-white" : "bg-brand-50 text-muted",
          )}
        >
          {index + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

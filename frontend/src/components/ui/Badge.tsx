import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const variants = {
  progress: "bg-brand-100 text-brand-700",
  danger: "bg-danger/10 text-danger",
  warning: "bg-warning/10 text-warning",
  success: "bg-success/10 text-success",
  neutral: "bg-black/5 text-muted",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-control px-2.5 py-1 text-[11px] font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

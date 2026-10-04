import type { HTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const variants = {
  progress: "bg-brand-100 text-brand-700",
  danger: "bg-risk/15 text-danger",
  warning: "bg-accent-soft text-warning",
  success: "bg-safe/15 text-success",
  neutral: "bg-black/5 text-muted",
};

type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  variant?: keyof typeof variants;
};

export function Badge({ className, variant = "neutral", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}

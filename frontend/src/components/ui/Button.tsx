import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";

import { cn } from "@/lib/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 min-h-11 rounded-control px-5 py-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-brand-600 text-white hover:bg-brand-800",
        accent: "bg-accent text-brand-950 hover:bg-accent-hover",
        secondary: "bg-white text-brand-950 hover:bg-brand-50",
        outline: "border border-border bg-transparent text-current hover:bg-black/5",
        ghost: "bg-transparent text-current hover:bg-black/5",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

type ButtonProps = ComponentPropsWithRef<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ asChild, className, variant, ...props }: ButtonProps) {
  const Component = asChild ? Slot : "button";
  return (
    <Component
      className={cn(buttonVariants({ variant }), className)}
      data-variant={variant ?? "primary"}
      {...props}
    />
  );
}

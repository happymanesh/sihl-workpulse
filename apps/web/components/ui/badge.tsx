import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Status and metadata chip.
 *
 * Deliberately built on subtle backgrounds with a coloured border and text
 * rather than saturated fills: a screen showing thirty rows of saturated
 * status blocks stops communicating urgency, which is precisely the failure
 * mode in the incumbent product's task grids. Reserve solid fills for the
 * one or two states that genuinely need to shout.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-2xs font-semibold uppercase tracking-[0.05em] whitespace-nowrap",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        info: "border-info/30 bg-info-subtle text-info",
        success: "border-success/30 bg-success-subtle text-success",
        warning: "border-warning/30 bg-warning-subtle text-warning",
        danger: "border-danger/30 bg-danger-subtle text-danger",
        solid: "border-transparent bg-danger text-danger-foreground",
        outline: "border-border bg-transparent text-muted-foreground",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

/**
 * Small state indicator. `label` is required rather than optional on purpose -
 * colour alone is not an accessible signal, so every dot is paired with text.
 */
export function StatusDot({
  tone = "neutral",
  label,
  className,
}: {
  tone?: "neutral" | "info" | "success" | "warning" | "danger";
  label: string;
  className?: string;
}) {
  const toneClass = {
    neutral: "bg-muted-foreground",
    info: "bg-info",
    success: "bg-success",
    warning: "bg-warning",
    danger: "bg-danger",
  }[tone];

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span className={cn("size-1.5 shrink-0 rounded-full", toneClass)} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export { badgeVariants };

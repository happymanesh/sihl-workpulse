"use client";

import { Minus, Plus } from "lucide-react";
import { useState } from "react";
import { DURATION_STEP, formatHhMm, parseHhMm, stepDuration } from "@/lib/duration";
import { cn } from "@/lib/utils";

/**
 * A duration in h:mm, with 30-minute steps either side.
 *
 * The field stays typeable on purpose. Steppers alone can only reach multiples
 * of 30, and plenty of real work is 45 minutes or 10 - a control that cannot
 * express the estimate someone actually has is a control they will fight.
 *
 * Typing is held as text while the field has focus, so a half-typed "1:" is not
 * parsed into something else under the typist's hands. It commits on blur, and
 * an unreadable value falls back to what was there before rather than to zero.
 */
export function DurationInput({
  value,
  onChange,
  min = 0,
  disabled,
  id,
  className,
  "aria-label": ariaLabel,
}: {
  value: number;
  onChange: (minutes: number) => void;
  min?: number;
  disabled?: boolean;
  id?: string;
  className?: string;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(() => formatHhMm(value));
  const [editing, setEditing] = useState(false);
  const [seen, setSeen] = useState(value);

  // Follow the value when it changes from outside - a stepper press, or a form
  // being reset - but never while someone is mid-keystroke in the box.
  // Adjusted during render rather than in an effect: React re-renders before
  // painting, so the box never shows the stale figure for a frame.
  if (!editing && value !== seen) {
    setSeen(value);
    setText(formatHhMm(value));
  }

  function commit() {
    setEditing(false);
    const parsed = parseHhMm(text);
    if (parsed === null) {
      setText(formatHhMm(value));
      return;
    }
    const clamped = Math.max(min, parsed);
    setText(formatHhMm(clamped));
    if (clamped !== value) onChange(clamped);
  }

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <button
        type="button"
        disabled={disabled || value <= min}
        onClick={() => onChange(stepDuration(value, -1, min))}
        aria-label={`Less ${DURATION_STEP} minutes`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <Minus className="size-3" aria-hidden />
      </button>

      <input
        id={id}
        type="text"
        inputMode="numeric"
        value={text}
        disabled={disabled}
        aria-label={ariaLabel ?? "Duration in hours and minutes"}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-16 rounded-md border border-input bg-card px-2 text-center text-xs tabular"
      />

      <button
        type="button"
        disabled={disabled}
        onClick={() => onChange(stepDuration(value, 1, min))}
        aria-label={`More ${DURATION_STEP} minutes`}
        className="inline-flex size-7 shrink-0 items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
      >
        <Plus className="size-3" aria-hidden />
      </button>

      <span className="text-2xs text-muted-foreground">h:mm</span>
    </div>
  );
}

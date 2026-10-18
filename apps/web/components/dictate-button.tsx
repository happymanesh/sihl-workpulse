"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Mic, Square } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Dictate a note instead of typing it.
 *
 * A large microphone with a ten-second countdown, matching SIHL-ONE so staff
 * meet the same control in both products. Ten seconds is a cap rather than a
 * target: it stops on its own, which matters because the common failure is
 * forgetting to press stop and sending two minutes of office noise to a
 * per-second billed service.
 *
 * The transcript is handed back for the caller to put in a textarea, never
 * submitted directly. Transcription misreads names and numbers, and a note
 * nobody read before saving is worse than one that was typed.
 */
export function DictateButton({
  onTranscript,
  disabled,
  seconds = 10,
  className,
}: {
  onTranscript: (text: string, languageCode: string | null) => void;
  disabled?: boolean;
  seconds?: number;
  className?: string;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [remaining, setRemaining] = useState(seconds);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ask the server whether dictation is switched on at all, so an unconfigured
  // deployment hides the button rather than offering one that always fails.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/backend/speech/availability")
      .then((r) => (r.ok ? r.json() : { available: false }))
      .then((d) => {
        if (!cancelled) setAvailable(Boolean(d.available));
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearTimers = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    if (stopRef.current) clearTimeout(stopRef.current);
    tickRef.current = null;
    stopRef.current = null;
  }, []);

  const stop = useCallback(() => {
    clearTimers();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  }, [clearTimers]);

  // Releasing the microphone on unmount matters: without it the browser keeps
  // showing the recording indicator after the user has navigated away.
  useEffect(() => () => {
    clearTimers();
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
  }, [clearTimers]);

  async function start() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setRemaining(seconds);

        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        if (blob.size < 1024) {
          setError("That was too short to make out. Hold the button and speak.");
          return;
        }

        setBusy(true);
        try {
          const form = new FormData();
          form.append("file", blob, "note.webm");
          const res = await fetch("/api/backend/speech/transcribe", { method: "POST", body: form });
          const body = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(body?.message ?? "That recording could not be transcribed. Type the note instead.");
            return;
          }
          onTranscript(body.text ?? "", body.language_code ?? body.languageCode ?? null);
        } catch {
          setError("The note could not be sent. Type it instead.");
        } finally {
          setBusy(false);
        }
      };

      recorder.start();
      setRecording(true);
      setRemaining(seconds);

      tickRef.current = setInterval(() => setRemaining((r) => Math.max(0, r - 1)), 1000);
      stopRef.current = setTimeout(stop, seconds * 1000);
    } catch {
      setError("workPulse could not reach your microphone. Check the browser's permission for this site.");
    }
  }

  if (available === false) return null;

  const pct = recording ? (remaining / seconds) * 100 : 100;

  return (
    <div className={cn("flex flex-col items-start gap-1.5", className)}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={recording ? stop : start}
          disabled={disabled || busy || available === null}
          aria-label={recording ? `Stop recording, ${remaining} seconds left` : "Dictate this note"}
          className={cn(
            "relative flex size-14 shrink-0 items-center justify-center rounded-full transition-colors",
            "disabled:pointer-events-none disabled:opacity-50",
            recording
              ? "bg-danger text-danger-foreground"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {busy ? (
            <Loader2 className="size-6 animate-spin" aria-hidden />
          ) : recording ? (
            <Square className="size-5" aria-hidden />
          ) : (
            <Mic className="size-6" aria-hidden />
          )}

          {recording && (
            <span
              aria-hidden
              className="pointer-events-none absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full bg-card text-2xs font-semibold tabular text-danger shadow"
            >
              {remaining}
            </span>
          )}
        </button>

        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium">
            {busy ? "Transcribing…" : recording ? "Listening — speak now" : "Dictate instead of typing"}
          </span>
          <span className="text-2xs text-muted-foreground">
            {recording
              ? `Stops on its own in ${remaining}s, or press to stop`
              : `Up to ${seconds} seconds. Speak in any language; the note is saved in English.`}
          </span>
        </div>
      </div>

      {recording && (
        <div className="h-1 w-48 overflow-hidden rounded-full bg-muted" role="presentation">
          <div
            className="h-full rounded-full bg-danger transition-[width] duration-1000 ease-linear"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {error && <p className="max-w-sm text-2xs text-danger">{error}</p>}
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * chat-hub's TopBar-style agent access point, same feature already built in
 * Synapse (components/app-shell/ChatHubBell.tsx there). Read-only: chat-hub
 * has no reply capability anywhere yet, so this shows a transcript, not a
 * reply box. Calls go through /api/backend/chat-hub/* (next.config.js's
 * existing rewrite to the NestJS API), which is where the Synapse-session
 * cookie is actually verified - this component has no auth logic of its own.
 */

interface ConversationSummary {
  conversationId: string;
  appName: string;
  agentName: string;
  lastMessage: string;
  lastMessageAt: string;
  messageCount: number;
}

interface Transcript {
  conversation: { id: string; status: string };
  messages: { id: string; sender_type: string; content: string; created_at: string }[];
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function ChatHubBell() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [open, setOpen] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/backend/chat-hub/conversations")
      .then((res) => (res.ok ? res.json() : []))
      .then((data: ConversationSummary[]) => {
        if (!cancelled) setConversations(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function openConversation(id: string) {
    setActiveId(id);
    setTranscript(null);
    setTranscriptLoading(true);
    fetch(`/api/backend/chat-hub/conversations/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Transcript | null) => setTranscript(data))
      .catch(() => setTranscript(null))
      .finally(() => setTranscriptLoading(false));
  }

  return (
    <div className="relative">
      <button
        type="button"
        title="Chat requests"
        onClick={() => setOpen((o) => !o)}
        className="relative inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
      >
        <MessageCircle className="size-3.5" />
        {conversations.length > 0 && (
          <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-0.5 text-[9px] font-semibold text-danger-foreground">
            {conversations.length > 99 ? "99+" : conversations.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-2 w-80 rounded-md border border-border bg-popover text-popover-foreground shadow-lg">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold text-muted-foreground uppercase">
            Chat requests
          </div>
          <div className="max-h-96 overflow-y-auto">
            {conversations.length === 0 ? (
              <p className="px-3 py-4 text-center text-sm text-muted-foreground">No chat requests</p>
            ) : (
              conversations.map((c) => (
                <button
                  key={c.conversationId}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    openConversation(c.conversationId);
                  }}
                  className="block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted"
                >
                  <p className="text-xs font-semibold text-muted-foreground">{c.appName}</p>
                  <p className="mt-0.5 truncate text-sm">{c.lastMessage}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatDateTime(c.lastMessageAt)}</p>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {activeId && (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center bg-black/40"
          onClick={() => setActiveId(null)}
        >
          <div
            className={cn(
              "max-h-[80vh] w-full max-w-md overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl",
            )}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-semibold">Chat requests</span>
              <button
                type="button"
                onClick={() => setActiveId(null)}
                className="inline-flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-4">
              {transcriptLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!transcriptLoading && !transcript && (
                <p className="text-sm text-muted-foreground">Could not load this conversation.</p>
              )}
              {transcript?.messages.map((m) => (
                <div key={m.id} className="mb-3 last:mb-0">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {m.sender_type === "visitor" ? "Visitor" : m.sender_type}
                  </p>
                  <p className="mt-0.5 text-sm whitespace-pre-wrap">{m.content}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime(m.created_at)}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

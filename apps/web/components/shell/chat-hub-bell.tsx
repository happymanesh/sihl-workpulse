"use client";

import { useEffect, useState } from "react";
import { MessageCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatHubSupabase } from "@/lib/chat-hub-browser-client";

/**
 * chat-hub's TopBar-style agent access point, same feature already built in
 * Synapse (components/app-shell/ChatHubBell.tsx there). Now reply-capable
 * (2026-09-23): a reply goes through /api/backend/chat-hub/conversations/:id/reply
 * (the NestJS controller re-checks ownership before ever calling chat-hub), and the
 * visitor's own follow-ups arrive live via a direct Supabase Realtime subscription
 * (see lib/chat-hub-browser-client.ts for why this talks to chat-hub's Supabase
 * project directly instead of through the backend).
 */

interface ConversationSummary {
  conversationId: string;
  appName: string;
  agentName: string;
  lastMessage: string;
  lastMessageAt: string;
  messageCount: number;
}

interface TranscriptMessage {
  id: string;
  conversation_id: string;
  sender_type: string;
  content: string;
  created_at: string;
}

interface Transcript {
  conversation: { id: string; status: string };
  messages: TranscriptMessage[];
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
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState(false);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);

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
    setMessages([]);
    setTranscriptError(false);
    setTranscriptLoading(true);
    fetch(`/api/backend/chat-hub/conversations/${id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Transcript | null) => {
        if (data) setMessages(data.messages);
        else setTranscriptError(true);
      })
      .catch(() => setTranscriptError(true))
      .finally(() => setTranscriptLoading(false));
  }

  // Delivers the visitor's follow-up messages live while the modal is open. Our own
  // replies are skipped here - already added optimistically in sendReply() below.
  useEffect(() => {
    if (!activeId) return;

    const channel = chatHubSupabase
      .channel(`messages:${activeId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${activeId}` },
        (payload) => {
          const incoming = payload.new as TranscriptMessage;
          if (incoming.sender_type === "agent") return;
          setMessages((prev) => (prev.some((m) => m.id === incoming.id) ? prev : [...prev, incoming]));
        },
      )
      .subscribe();

    return () => {
      chatHubSupabase.removeChannel(channel);
    };
  }, [activeId]);

  function sendReply() {
    const content = reply.trim();
    if (!content || !activeId || sending) return;

    setSending(true);
    setReply("");
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), conversation_id: activeId, sender_type: "agent", content, created_at: new Date().toISOString() },
    ]);

    fetch(`/api/backend/chat-hub/conversations/${activeId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    })
      .then((res) => {
        if (!res.ok) throw new Error();
      })
      .catch(() => setTranscriptError(true))
      .finally(() => setSending(false));
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
              "flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-xl",
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
            <div className="flex-1 overflow-y-auto p-4">
              {transcriptLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
              {!transcriptLoading && transcriptError && messages.length === 0 && (
                <p className="text-sm text-muted-foreground">Could not load this conversation.</p>
              )}
              {messages.map((m) => (
                <div key={m.id} className={cn("mb-3 flex last:mb-0", m.sender_type === "agent" ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-lg px-3 py-1.5",
                      m.sender_type === "agent" ? "bg-primary text-primary-foreground" : "bg-muted",
                    )}
                  >
                    <p className="text-sm whitespace-pre-wrap">{m.content}</p>
                    <p className="mt-0.5 text-[10px] opacity-70">{formatDateTime(m.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-border p-3">
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendReply()}
                placeholder="Type a reply…"
                disabled={sending}
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
              <button
                type="button"
                onClick={sendReply}
                disabled={sending || !reply.trim()}
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
              >
                Send
              </button>
            </div>
            {transcriptError && messages.length > 0 && (
              <p className="px-3 pb-2 text-xs text-danger">Could not send reply.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

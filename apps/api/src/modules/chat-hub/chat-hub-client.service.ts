import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/**
 * Read-only client for chat-hub's service API - the same TopBar-style agent
 * access point already built in Synapse (src/lib/chat-hub/client.ts there).
 * See chat-hub's own README, "Phase 2 design: agent access point inside
 * Synapse", for the full cross-repo design (the doc predates workPulse's
 * integration but the mechanism is identical).
 *
 * Optional, not mandatory like SESSION_SECRET: an absent or unreachable
 * chat-hub must not take workPulse down with it, so this fails quietly
 * (empty results) rather than throwing - same discipline as
 * IntakeService.pushStatus's outbound webhook call.
 */
export interface ChatHubConversationSummary {
  conversationId: string;
  appName: string;
  agentName: string;
  lastMessage: string;
  lastMessageAt: string;
  messageCount: number;
}

export interface ChatHubMessage {
  id: string;
  conversation_id: string;
  sender_type: "visitor" | "ai" | "agent";
  content: string;
  created_at: string;
}

export interface ChatHubTranscript {
  conversation: { id: string; status: string; requested_agent_id: string | null };
  messages: ChatHubMessage[];
}

@Injectable()
export class ChatHubClientService {
  private readonly logger = new Logger(ChatHubClientService.name);

  constructor(private readonly config: ConfigService) {}

  private async serviceFetch(path: string, init: RequestInit = {}): Promise<Response | null> {
    const baseUrl = this.config.get<string>("CHAT_HUB_BASE_URL");
    const serviceSecret = this.config.get<string>("CHAT_HUB_SERVICE_SECRET");
    if (!baseUrl || !serviceSecret) {
      this.logger.debug(`chat-hub not configured, skipping ${path}`);
      return null;
    }

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: { ...init.headers, Authorization: `Bearer ${serviceSecret}` },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        this.logger.warn(`chat-hub ${path} -> HTTP ${response.status}`);
        return null;
      }
      return response;
    } catch (err) {
      this.logger.warn(`chat-hub ${path} failed: ${(err as Error).message}`);
      return null;
    }
  }

  /** Every targeted conversation waiting for this Synapse username, across every chat-hub app they're linked to. */
  async getAgentConversations(username: string): Promise<ChatHubConversationSummary[]> {
    const response = await this.serviceFetch(`/api/service/agents/${encodeURIComponent(username)}/conversations`);
    if (!response) return [];
    const data = await response.json();
    return data.conversations ?? [];
  }

  /** Read-only transcript for one conversation. Caller must verify ownership first - this itself doesn't check who's asking. */
  async getConversationTranscript(conversationId: string): Promise<ChatHubTranscript | null> {
    const response = await this.serviceFetch(`/api/service/conversations/${encodeURIComponent(conversationId)}`);
    if (!response) return null;
    return response.json();
  }

  /**
   * Sends a reply as `username`. chat-hub verifies username is actually the agent this
   * conversation is targeted at - a caller can't reply as someone else's conversation
   * just by holding the shared secret. Returns null on any failure; the caller decides
   * what to show, this layer doesn't distinguish why.
   */
  async sendReply(conversationId: string, username: string, content: string): Promise<ChatHubMessage | null> {
    const response = await this.serviceFetch(`/api/service/conversations/${encodeURIComponent(conversationId)}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ synapseUsername: username, content }),
    });
    if (!response) return null;
    const data = await response.json();
    return data.message ?? null;
  }
}

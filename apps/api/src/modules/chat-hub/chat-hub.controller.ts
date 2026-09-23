import { Controller, Get, NotFoundException, Param, Req } from "@nestjs/common";
import type { Request } from "express";
import type { AuthenticatedUser } from "../auth/identity.service";
import { ChatHubClientService, type ChatHubTranscript } from "./chat-hub-client.service";

/**
 * Protected by the global SynapseAuthGuard (no @Public() here), so
 * request.workPulseUser is already resolved by the time these handlers run.
 *
 * chat-hub's own service endpoint trusts whoever holds CHAT_HUB_SERVICE_SECRET
 * and does not scope by agent - the ownership check for :id below has to live
 * here, same reasoning as Synapse's equivalent route.
 */
@Controller("chat-hub")
export class ChatHubController {
  constructor(private readonly chatHub: ChatHubClientService) {}

  @Get("conversations")
  async listConversations(@Req() request: Request) {
    const user = (request as Request & { workPulseUser: AuthenticatedUser }).workPulseUser;
    return this.chatHub.getAgentConversations(user.username);
  }

  @Get("conversations/:id")
  async getConversation(@Req() request: Request, @Param("id") id: string): Promise<ChatHubTranscript> {
    const user = (request as Request & { workPulseUser: AuthenticatedUser }).workPulseUser;

    const owned = await this.chatHub.getAgentConversations(user.username);
    if (!owned.some((c) => c.conversationId === id)) {
      throw new NotFoundException("Conversation not found");
    }

    const transcript = await this.chatHub.getConversationTranscript(id);
    if (!transcript) {
      throw new NotFoundException("Conversation not found");
    }
    return transcript;
  }
}

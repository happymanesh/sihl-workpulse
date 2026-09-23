import { Module } from "@nestjs/common";
import { ChatHubController } from "./chat-hub.controller";
import { ChatHubClientService } from "./chat-hub-client.service";

@Module({
  controllers: [ChatHubController],
  providers: [ChatHubClientService],
})
export class ChatHubModule {}

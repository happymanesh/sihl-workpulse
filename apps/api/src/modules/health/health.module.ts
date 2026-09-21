import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { HealthController } from "./health.controller";
import { HealthService } from "./health.service";

@Module({
  // For SynapseDirectoryService: Synapse's reachability is part of this
  // service's health now that identity is federated to it.
  imports: [AuthModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}

import { Controller, Get, HttpCode, HttpStatus } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { HealthService } from "./health.service";
import type { HealthStatus } from "@workpulse/shared-types";

@Controller("health")
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  // Unauthenticated on purpose - load balancers and uptime monitors need to
  // hit this without a Keycloak token.
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  async check(): Promise<HealthStatus> {
    return this.healthService.check();
  }
}

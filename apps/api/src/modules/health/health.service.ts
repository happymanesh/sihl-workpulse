import { Injectable, Logger } from "@nestjs/common";
import { Redis } from "ioredis";
import { prisma } from "@workpulse/db";
import type { HealthStatus } from "@workpulse/shared-types";
import { SynapseDirectoryService } from "../auth/synapse-directory.service";
import { BUILD_REVISION, BUILD_VERSION } from "../../build-revision";


@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);
  private readonly redis: Redis;

  constructor(private readonly synapseDirectory: SynapseDirectoryService) {
    // Deliberately not injecting a shared Redis client here - health checks
    // should not depend on the same connection pool that BullMQ workers use,
    // so a stuck job queue doesn't silently make health checks pass or fail
    // for the wrong reason.
    this.redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      lazyConnect: true,
      connectTimeout: 2000,
      maxRetriesPerRequest: 1,
    });
  }

  async check(): Promise<HealthStatus> {
    const [database, redis, synapse] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkSynapse(),
    ]);

    const checks = { database, redis, synapse };
    const failed = Object.values(checks).filter((c) => c === "error").length;

    // Synapse being unreachable is never merely "degraded": with identity
    // federated to it, the API can authenticate nobody, so the service is down
    // whatever else is healthy.
    const status: HealthStatus["status"] =
      synapse === "error" || failed === Object.keys(checks).length ? "down" : failed > 0 ? "degraded" : "ok";

    return {
      status,
      service: "workpulse-api",
      version: BUILD_VERSION,
      revision: BUILD_REVISION,
      timestamp: new Date().toISOString(),
      checks,
    };
  }

  private async checkDatabase(): Promise<"ok" | "error"> {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return "ok";
    } catch (err) {
      this.logger.warn(`Database health check failed: ${(err as Error).message}`);
      return "error";
    }
  }

  private async checkRedis(): Promise<"ok" | "error"> {
    try {
      await this.redis.connect();
      const pong = await this.redis.ping();
      await this.redis.quit();
      return pong === "PONG" ? "ok" : "error";
    } catch (err) {
      this.logger.warn(`Redis health check failed: ${(err as Error).message}`);
      return "error";
    }
  }

  private async checkSynapse(): Promise<"ok" | "error"> {
    return (await this.synapseDirectory.isReachable()) ? "ok" : "error";
  }
}

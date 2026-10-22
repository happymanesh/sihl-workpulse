import { execFileSync } from "node:child_process";
import { Injectable, Logger } from "@nestjs/common";
import { Redis } from "ioredis";
import { prisma } from "@workpulse/db";
import type { HealthStatus } from "@workpulse/shared-types";
import { SynapseDirectoryService } from "../auth/synapse-directory.service";

/**
 * Which commit this process is running, worked out once at startup.
 *
 * GIT_SHA first, for builds where the source is not present at runtime — a
 * container, or a tarball copied onto a host. Otherwise ask git, which works
 * because deployment here is a pull on the box, so the repository is sitting
 * right there.
 *
 * Never throws and never blocks a health check: a service that will not report
 * its own health because it could not name its commit is worse than one that
 * says "unknown".
 */
const REVISION: string = (() => {
  const fromEnv = process.env.GIT_SHA?.trim();
  if (fromEnv) return fromEnv.slice(0, 12);

  try {
    // execFileSync, not exec: no shell, so nothing here can be interpreted.
    return execFileSync("git", ["rev-parse", "--short=12", "HEAD"], {
      cwd: __dirname,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000,
    }).trim();
  } catch {
    return "unknown";
  }
})();

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
      version: process.env.npm_package_version ?? "0.0.1",
      revision: REVISION,
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

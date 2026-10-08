import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Pool } from "pg";

export interface SynapseRoleRecord {
  roleCode: string;
  roleName: string;
  companyCode: string | null;
  hierarchyCode: string | null;
}

export interface SynapseUserRecord {
  uid: number;
  username: string;
  fullName: string;
  email: string | null;
  /** The key workPulse links a user to an Employee by (never email). */
  employeeCode: string | null;
  isActive: boolean;
}

/**
 * Read-only window onto Synapse's user directory.
 *
 * Uses `pg` directly rather than a second Prisma client. Two reasons: we need
 * exactly three queries, and a Prisma schema would imply we can migrate that
 * database - which we must never do. Synapse owns it, and CLAUDE.md's rule that
 * Prisma migrations are the source of truth applies to workPulse's own schema
 * only.
 *
 * Point SYNAPSE_DATABASE_URL at a Postgres role with SELECT and nothing else
 * (decision S-03). Synapse already establishes this pattern with its own
 * DATABASE_URL_READONLY. Every statement below is a parameterised SELECT; there
 * is deliberately no method on this class that writes.
 */
@Injectable()
export class SynapseDirectoryService implements OnModuleDestroy {
  private readonly logger = new Logger(SynapseDirectoryService.name);
  private readonly pool: Pool | null;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>("SYNAPSE_DATABASE_URL");
    if (!url) {
      this.logger.warn(
        "SYNAPSE_DATABASE_URL is not set - every request will be rejected because the active-user check cannot run. See docs/synapse-integration.md",
      );
      this.pool = null;
      return;
    }
    this.pool = new Pool({ connectionString: url, max: 5, idleTimeoutMillis: 30_000 });
  }

  async onModuleDestroy() {
    await this.pool?.end();
  }

  /**
   * The live revocation check. Synapse's getSession() runs this on every call
   * so that deactivating someone takes effect immediately rather than at token
   * expiry; workPulse must match that or it becomes the weak link.
   *
   * Returns null when the user does not exist, is inactive, is SUSPENDED, or the
   * directory is unreachable - the caller treats null as "not authorised", so an
   * outage fails closed. Suspension mirrors Synapse's accountBlock(): a suspended
   * Synapse user (e.g. frozen in HR) must not keep working here either.
   */
  async findActiveUser(userUid: number): Promise<SynapseUserRecord | null> {
    if (!this.pool) return null;
    try {
      const { rows } = await this.pool.query<{
        uid: number;
        username: string;
        full_name: string;
        email: string | null;
        employee_code: string | null;
        is_active: boolean;
        is_suspended: boolean;
      }>(
        `SELECT uid, username, full_name, email, employee_code, is_active, is_suspended
           FROM user_details
          WHERE uid = $1`,
        [userUid],
      );
      const row = rows[0];
      if (!row || !row.is_active || row.is_suspended) return null;
      return {
        uid: row.uid,
        username: row.username,
        fullName: row.full_name,
        email: row.email,
        employeeCode: row.employee_code,
        isActive: row.is_active,
      };
    } catch (err) {
      this.logger.error(`Synapse directory lookup failed: ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Role codes from Synapse's user_role_map. Read fresh rather than trusted from
   * the JWT: a role revoked mid-session must take effect on the next request,
   * not in eight hours.
   */
  async findRoleCodes(userUid: number): Promise<string[]> {
    if (!this.pool) return [];
    try {
      const { rows } = await this.pool.query<{ role_code: string }>(
        `SELECT role_code
           FROM user_role_map
          WHERE user_uid = $1
            AND is_active = true`,
        [userUid],
      );
      return rows.map((r) => r.role_code);
    } catch (err) {
      this.logger.error(`Synapse role lookup failed: ${(err as Error).message}`);
      return [];
    }
  }

  /**
   * The Synapse role catalogue.
   *
   * Read so that a mapping cannot be created against a role code Synapse has
   * never heard of - such a row grants nothing while looking like coverage,
   * which is worse than an obvious gap.
   *
   * Returns an empty array when the directory is unreachable. Callers must
   * treat that as "could not ask", never as "Synapse has no roles".
   */
  async listRoles(): Promise<SynapseRoleRecord[]> {
    if (!this.pool) return [];
    try {
      const { rows } = await this.pool.query<{
        role_code: string;
        role_name: string;
        company_code: string | null;
        hierarchy_code: string | null;
      }>(
        `SELECT role_code, role_name, company_code, hierarchy_code
           FROM role_master
          WHERE is_active = true
          ORDER BY role_code`,
      );
      return rows.map((r) => ({
        roleCode: r.role_code,
        roleName: r.role_name,
        companyCode: r.company_code,
        hierarchyCode: r.hierarchy_code,
      }));
    } catch (err) {
      this.logger.error(`Synapse role catalogue lookup failed: ${(err as Error).message}`);
      return [];
    }
  }

  /** Health probe for the /health endpoint. */
  async isReachable(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      await this.pool.query("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}

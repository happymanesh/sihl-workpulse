/**
 * Types shared between apps/api and apps/web so the frontend and backend
 * never drift out of sync on shape. Keep this package free of framework
 * dependencies (no Prisma, no Nest, no React) - plain TypeScript only.
 */

export interface HealthStatus {
  status: "ok" | "degraded" | "down";
  service: string;
  version: string;
  timestamp: string;
  checks: {
    database: "ok" | "error";
    redis: "ok" | "error";
    /**
     * Synapse's user directory. A hard dependency, not a nicety: identity is
     * federated to Synapse, and the active-user re-check runs against it on
     * every request. If this is in error, the API is authenticating nobody.
     */
    synapse: "ok" | "error";
  };
}

export interface EmployeeSummary {
  id: string;
  name: string;
  email: string;
  designation: string | null;
  departmentName: string | null;
  isActive: boolean;
}

/**
 * Mirrors the Prisma WorkPulseRole enum (packages/db). Duplicated here
 * deliberately - shared-types must not depend on @workpulse/db, since
 * apps/web should never need a Prisma client in its dependency tree.
 * If these drift, a Phase-1 CI check should diff them against the Prisma
 * schema automatically rather than relying on developers noticing by eye.
 */
export type WorkPulseRoleName =
  | "SYSTEM_ADMIN"
  | "EMPLOYEE"
  | "MANAGER"
  | "DEPARTMENT_HEAD"
  | "PROJECT_MANAGER"
  | "EXECUTIVE"
  | "EXECUTIVE_RESTRICTED"
  | "AUDIT"
  | "INTEGRATION_SERVICE";

export interface FrappeHrSyncResult {
  startedAt: string;
  finishedAt: string;
  mode: "mock" | "live";
  employeesSynced: number;
  departmentsSynced: number;
  errors: string[];
}

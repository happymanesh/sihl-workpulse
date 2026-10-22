import { Pool } from "pg";
import type { FrappeHrClient, RawFrappeDepartment, RawFrappeEmployee } from "./frappe-hr-client";

/**
 * HR source: Synapse (the default since 2026-10-07, HR_SOURCE=synapse).
 *
 * Synapse ingests SIHL's HR system (Spine HR) into its own `hr_employee` table, and its
 * users carry an `employee_code`. workPulse reads both, read-only, so there is one HR
 * source for the two systems instead of a second integration to drift.
 *
 * Employees come from two places:
 *   1. hr_employee — every HR record. The code is the linked Synapse user's employee_code
 *      when there is one (that is what identity links by), else the HR code.
 *   2. user_details with an employee_code but no HR link — people created by hand in
 *      Synapse (with the designation/department/manager fields on its User Master).
 *
 * Departments are the distinct department names; Synapse has no department hierarchy, so
 * parentDepartmentId is always null. The department "id" is its name.
 *
 * The manager is the HR value when HR supplies one (Spine does not yet), else the value an
 * administrator set on the Synapse user.
 *
 * Same connection and role as SynapseDirectoryService (SYNAPSE_DATABASE_URL, a SELECT-only
 * role — decision S-03). Every statement here is a SELECT.
 */
export class SynapseHrClient implements FrappeHrClient {
  constructor(private readonly connectionString: string) {}

  private async query<T>(sql: string): Promise<T[]> {
    const pool = new Pool({ connectionString: this.connectionString, max: 1 });
    try {
      return (await pool.query(sql)).rows as T[];
    } finally {
      await pool.end();
    }
  }

  async fetchEmployees(): Promise<RawFrappeEmployee[]> {
    const rows = await this.query<{
      code: string;
      name: string | null;
      email: string | null;
      designation: string | null;
      branch: string | null;
      department: string | null;
      manager_code: string | null;
      is_active: boolean;
    }>(`
      SELECT COALESCE(u.employee_code, e.source_employee_id)                 AS code,
             NULLIF(trim(concat_ws(' ', e.first_name, e.last_name)), '')     AS name,
             e.email,
             e.designation,
             e.branch,
             e.department,
             COALESCE(e.reporting_manager_code, u.reporting_manager_code)    AS manager_code,
             e.employment_status = 'ACTIVE'                                  AS is_active
        FROM hr_employee e
        LEFT JOIN user_details u ON u.hr_employee_id = e.id
      UNION ALL
      SELECT u.employee_code, u.full_name, u.email, u.designation, NULL AS branch, u.department,
             u.reporting_manager_code,
             u.is_active AND NOT u.is_suspended
        FROM user_details u
       WHERE u.employee_code IS NOT NULL
         AND u.hr_employee_id IS NULL`);

    return rows.map((r) => ({
      employeeId: r.code,
      fullName: r.name ?? r.code,
      email: r.email,
      designation: r.designation,
      branch: r.branch,
      departmentId: r.department,
      managerEmployeeId: r.manager_code,
      isActive: r.is_active,
    }));
  }

  async fetchDepartments(): Promise<RawFrappeDepartment[]> {
    const rows = await this.query<{ name: string }>(`
      SELECT DISTINCT d AS name FROM (
        SELECT department AS d FROM hr_employee WHERE department IS NOT NULL
        UNION
        SELECT department FROM user_details WHERE department IS NOT NULL AND employee_code IS NOT NULL
      ) x
      ORDER BY 1`);
    return rows.map((r) => ({ departmentId: r.name, name: r.name, parentDepartmentId: null }));
  }
}

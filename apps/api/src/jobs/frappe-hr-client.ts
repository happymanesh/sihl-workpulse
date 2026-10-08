import { SynapseHrClient } from "./synapse-hr-client";

/**
 * Client for reading Employee/Department data out of an HR source. Since
 * 2026-10-07 the default source is Synapse (SynapseHrClient, synapse-hr-client.ts:
 * Spine HR as curated into Synapse's hr_employee, plus Synapse users that carry an
 * employee code). Select with HR_SOURCE=synapse|frappe; createFrappeHrClient()
 * below does the choosing. The Frappe implementations:
 *
 *  - MockFrappeHrClient: generates realistic fixture data. Default while
 *    FRAPPE_SYNC_MODE=mock, so the rest of workPulse can be built and
 *    tested end-to-end against realistic data before real SIHL Frappe HR
 *    API credentials exist.
 *  - LiveFrappeHrClient: calls the real Frappe REST API. Fill in once
 *    FRAPPE_BASE_URL / FRAPPE_API_KEY / FRAPPE_API_SECRET are available
 *    and flip FRAPPE_SYNC_MODE=live in .env.
 *
 * Both implement the same interface so frappe-hr-sync.job.ts never needs
 * to know which one it's talking to.
 */

export interface RawFrappeEmployee {
  /** The employee code: Employee.employeeCode, and the key Synapse users link by. */
  employeeId: string;
  fullName: string;
  /** Not an identifier: team-shared mailboxes exist, and some staff have none. */
  email: string | null;
  designation: string | null;
  departmentId: string | null;
  managerEmployeeId: string | null;
  isActive: boolean;
}

export interface RawFrappeDepartment {
  departmentId: string;
  name: string;
  parentDepartmentId: string | null;
}

export interface FrappeHrClient {
  fetchEmployees(): Promise<RawFrappeEmployee[]>;
  fetchDepartments(): Promise<RawFrappeDepartment[]>;
}

const MOCK_DEPARTMENTS: RawFrappeDepartment[] = [
  { departmentId: "DEPT-COMPLIANCE", name: "Compliance", parentDepartmentId: null },
  { departmentId: "DEPT-OPERATIONS", name: "Operations", parentDepartmentId: null },
  { departmentId: "DEPT-TECHNOLOGY", name: "Technology", parentDepartmentId: null },
  { departmentId: "DEPT-RISK", name: "Risk", parentDepartmentId: null },
  { departmentId: "DEPT-PRODUCT", name: "Product", parentDepartmentId: null },
];

const MOCK_EMPLOYEES: RawFrappeEmployee[] = [
  {
    employeeId: "EMP-0001",
    fullName: "Rohan Mehta",
    email: "rohan.mehta@sihl.example",
    designation: "Compliance Officer",
    departmentId: "DEPT-COMPLIANCE",
    managerEmployeeId: "EMP-0005",
    isActive: true,
  },
  {
    employeeId: "EMP-0002",
    fullName: "Sneha Nair",
    email: "sneha.nair@sihl.example",
    designation: "Operations Executive",
    departmentId: "DEPT-OPERATIONS",
    managerEmployeeId: "EMP-0006",
    isActive: true,
  },
  {
    employeeId: "EMP-0003",
    fullName: "Arjun Kapoor",
    email: "arjun.kapoor@sihl.example",
    designation: "Project Manager",
    departmentId: "DEPT-TECHNOLOGY",
    managerEmployeeId: "EMP-0007",
    isActive: true,
  },
  {
    employeeId: "EMP-0004",
    fullName: "Priya Iyer",
    email: "priya.iyer@sihl.example",
    designation: "Support Specialist",
    departmentId: "DEPT-OPERATIONS",
    managerEmployeeId: "EMP-0006",
    isActive: true,
  },
  {
    employeeId: "EMP-0005",
    fullName: "Ananya Desai",
    email: "ananya.desai@sihl.example",
    designation: "Compliance Head",
    departmentId: "DEPT-COMPLIANCE",
    managerEmployeeId: null,
    isActive: true,
  },
  {
    employeeId: "EMP-0006",
    fullName: "Vikram Shah",
    email: "vikram.shah@sihl.example",
    designation: "Operations Head",
    departmentId: "DEPT-OPERATIONS",
    managerEmployeeId: null,
    isActive: true,
  },
  {
    employeeId: "EMP-0007",
    fullName: "Neha Kulkarni",
    email: "neha.kulkarni@sihl.example",
    designation: "CTO",
    departmentId: "DEPT-TECHNOLOGY",
    managerEmployeeId: null,
    isActive: true,
  },
];

export class MockFrappeHrClient implements FrappeHrClient {
  async fetchEmployees(): Promise<RawFrappeEmployee[]> {
    // Local-dev affordance. Employees link to Synapse users by employee code,
    // and the fixture codes (EMP-0001...) match nobody in a real Synapse, so
    // "My tasks" and "My desk card" would always be empty when demoing.
    //
    // Setting FRAPPE_MOCK_LINK_CODE to your own Synapse user's employee code
    // re-points the first fixture employee at it, so the whole loop - desk card,
    // generated task, completion - is visible under one login. Managers that
    // pointed at the old fixture code follow it.
    //
    // Deliberately an env var rather than an edit to the fixture. Ignored
    // entirely outside mock mode.
    const linkCode = process.env.FRAPPE_MOCK_LINK_CODE?.trim();
    if (!linkCode) return MOCK_EMPLOYEES;

    const original = MOCK_EMPLOYEES[0].employeeId;
    return MOCK_EMPLOYEES.map((e, i) => ({
      ...e,
      employeeId: i === 0 ? linkCode : e.employeeId,
      managerEmployeeId: e.managerEmployeeId === original ? linkCode : e.managerEmployeeId,
    }));
  }

  async fetchDepartments(): Promise<RawFrappeDepartment[]> {
    return MOCK_DEPARTMENTS;
  }
}

export class LiveFrappeHrClient implements FrappeHrClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  async fetchEmployees(): Promise<RawFrappeEmployee[]> {
    // TODO (Phase 1, once SIHL Frappe HR API credentials exist): call
    // `${this.baseUrl}/api/resource/Employee?fields=[...]` with
    // Authorization: `token ${apiKey}:${apiSecret}`, paginate via
    // limit_start/limit_page_length, and map Frappe's field names onto
    // RawFrappeEmployee. Confirm exact Employee doctype field names
    // against SIHL's actual Frappe HR instance first (Appendix F,
    // Frappe Architecture category) - they may differ from vanilla
    // Frappe HR if SIHL has customised the doctype.
    throw new Error(
      "LiveFrappeHrClient.fetchEmployees is not implemented yet - see TODO in frappe-hr-client.ts. " +
        "Set FRAPPE_SYNC_MODE=mock in .env until this is wired up.",
    );
  }

  async fetchDepartments(): Promise<RawFrappeDepartment[]> {
    // TODO: same shape as fetchEmployees, against the Department doctype.
    throw new Error(
      "LiveFrappeHrClient.fetchDepartments is not implemented yet - see TODO in frappe-hr-client.ts. " +
        "Set FRAPPE_SYNC_MODE=mock in .env until this is wired up.",
    );
  }
}

/** Which HR source the sync reads. Default: Synapse (decided 2026-10-07). */
export function hrSource(): "synapse" | "frappe" {
  return process.env.HR_SOURCE === "frappe" ? "frappe" : "synapse";
}

export function createFrappeHrClient(): FrappeHrClient {
  if (hrSource() === "synapse") {
    const url = process.env.SYNAPSE_DATABASE_URL;
    if (!url) {
      throw new Error("HR_SOURCE=synapse (the default) requires SYNAPSE_DATABASE_URL. Set HR_SOURCE=frappe to use Frappe HR.");
    }
    return new SynapseHrClient(url);
  }
  const mode = process.env.FRAPPE_SYNC_MODE ?? "mock";
  if (mode === "live") {
    const baseUrl = process.env.FRAPPE_BASE_URL;
    const apiKey = process.env.FRAPPE_API_KEY;
    const apiSecret = process.env.FRAPPE_API_SECRET;
    if (!baseUrl || !apiKey || !apiSecret) {
      throw new Error(
        "FRAPPE_SYNC_MODE=live requires FRAPPE_BASE_URL, FRAPPE_API_KEY and FRAPPE_API_SECRET to be set in .env",
      );
    }
    return new LiveFrappeHrClient(baseUrl, apiKey, apiSecret);
  }
  return new MockFrappeHrClient();
}

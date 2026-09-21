import { runFrappeHrSync } from "./frappe-hr-sync";
import { MockFrappeHrClient } from "./frappe-hr-client";

// This test hits the real Prisma client against whatever DATABASE_URL is
// configured for the test environment. In CI this points at the ephemeral
// Postgres service defined in .github/workflows/ci.yml. It is intentionally
// NOT mocking Prisma - the manager/department two-pass resolution logic in
// frappe-hr-sync.ts is exactly the kind of thing that looks right with a
// mocked ORM and breaks against a real database.
describe("runFrappeHrSync", () => {
  it("syncs mock employees and departments with manager/department links resolved", async () => {
    const result = await runFrappeHrSync(new MockFrappeHrClient());

    expect(result.errors).toEqual([]);
    expect(result.departmentsSynced).toBeGreaterThan(0);
    expect(result.employeesSynced).toBeGreaterThan(0);
    expect(result.mode).toBeDefined();
  });
});

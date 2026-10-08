-- Link users to employees by EMPLOYEE CODE, not email (SIHL, 2026-10-07).
--
-- Hand-written: `prisma migrate dev` would drop frappeEmployeeId and add employeeCode as a
-- new required column, losing every existing value. A rename keeps the data and the index.
--
-- The column now holds the HR employee code (Spine's Employee_Code via Synapse, or Frappe HR's
-- Employee ID when HR_SOURCE=frappe) - the same value as Synapse user_details.employee_code.

-- AlterTable: rename the join key
ALTER TABLE "employees" RENAME COLUMN "frappeEmployeeId" TO "employeeCode";
ALTER INDEX "employees_frappeEmployeeId_key" RENAME TO "employees_employeeCode_key";

-- Email is no longer an identifier: team-shared mailboxes mean several employees can have the
-- same address, and some staff have none.
DROP INDEX "employees_email_key";
ALTER TABLE "employees" ALTER COLUMN "email" DROP NOT NULL;

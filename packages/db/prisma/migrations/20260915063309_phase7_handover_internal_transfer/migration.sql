/*
  Warnings:

  - You are about to drop the `exit_checklist_items` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `exit_checklists` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "HandoverItemType" AS ENUM ('OPEN_TASK', 'DESK_CARD_HOLDER', 'RECURRING_ACTIVITY', 'RACI_ROLE', 'DACI_ROLE', 'PENDING_APPROVAL', 'PROCESS_OWNER', 'POLICY_OWNER', 'DELEGATION');

-- CreateEnum
CREATE TYPE "HandoverStatus" AS ENUM ('OPEN', 'COMPLETE', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "HandoverReason" AS ENUM ('EXIT', 'INTERNAL_TRANSFER', 'ROLE_CHANGE');

-- CreateEnum
CREATE TYPE "HandoverItemDisposition" AS ENUM ('HAND_OVER', 'RETAINED');

-- DropForeignKey
ALTER TABLE "exit_checklist_items" DROP CONSTRAINT "exit_checklist_items_checklistId_fkey";

-- DropForeignKey
ALTER TABLE "exit_checklists" DROP CONSTRAINT "exit_checklists_employeeId_fkey";

-- DropTable
DROP TABLE "exit_checklist_items";

-- DropTable
DROP TABLE "exit_checklists";

-- DropEnum
DROP TYPE "ExitChecklistStatus";

-- DropEnum
DROP TYPE "ExitItemType";

-- CreateTable
CREATE TABLE "handovers" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "reason" "HandoverReason" NOT NULL DEFAULT 'EXIT',
    "effectiveDate" TIMESTAMP(3),
    "replacementEmployeeId" TEXT,
    "toDepartmentId" TEXT,
    "status" "HandoverStatus" NOT NULL DEFAULT 'OPEN',
    "releasingApprovedByUserId" TEXT,
    "releasingApprovedAt" TIMESTAMP(3),
    "receivingApprovedByUserId" TEXT,
    "receivingApprovedAt" TIMESTAMP(3),
    "overrideReason" TEXT,
    "overrideByUserId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "handovers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handover_items" (
    "id" TEXT NOT NULL,
    "handoverId" TEXT NOT NULL,
    "itemType" "HandoverItemType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "disposition" "HandoverItemDisposition" NOT NULL DEFAULT 'HAND_OVER',
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "transferredToEmployeeId" TEXT,
    "transferredAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "handover_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "handovers_employeeId_status_idx" ON "handovers"("employeeId", "status");

-- CreateIndex
CREATE INDEX "handover_items_handoverId_isBlocking_idx" ON "handover_items"("handoverId", "isBlocking");

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handovers" ADD CONSTRAINT "handovers_toDepartmentId_fkey" FOREIGN KEY ("toDepartmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handover_items" ADD CONSTRAINT "handover_items_handoverId_fkey" FOREIGN KEY ("handoverId") REFERENCES "handovers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One OPEN handover per employee, enforced by the database rather than
-- remembered by the service. A person may transfer several times and then
-- eventually leave - each is its own row - but two concurrent open handovers
-- for the same person would let two managers hand the same work to two
-- different people.
CREATE UNIQUE INDEX "handovers_one_open_per_employee"
  ON "handovers" ("employeeId")
  WHERE "status" = 'OPEN';

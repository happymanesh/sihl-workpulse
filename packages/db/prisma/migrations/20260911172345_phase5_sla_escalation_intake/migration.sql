-- CreateEnum
CREATE TYPE "EscalationTarget" AS ENUM ('ASSIGNEE', 'REVIEWER', 'LINE_MANAGER', 'DEPARTMENT_HEAD', 'PROCESS_OWNER');

-- CreateEnum
CREATE TYPE "ExitItemType" AS ENUM ('OPEN_TASK', 'DESK_CARD_HOLDER', 'RECURRING_ACTIVITY', 'RACI_ROLE', 'DACI_ROLE', 'PENDING_APPROVAL', 'PROCESS_OWNER', 'POLICY_OWNER', 'DELEGATION');

-- CreateEnum
CREATE TYPE "ExitChecklistStatus" AS ENUM ('OPEN', 'COMPLETE', 'OVERRIDDEN');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "sourceReference" TEXT,
ADD COLUMN     "sourceSystemId" TEXT;

-- CreateTable
CREATE TABLE "sla_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "taskTypeId" TEXT,
    "priority" "Priority",
    "departmentId" TEXT,
    "sourceSystemId" TEXT,
    "responseMinutes" INTEGER,
    "resolutionMinutes" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sla_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_rules" (
    "id" TEXT NOT NULL,
    "slaDefinitionId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "thresholdPercent" INTEGER NOT NULL,
    "notifyTarget" "EscalationTarget" NOT NULL,
    "isMutable" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "escalation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_escalations" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "thresholdPercent" INTEGER NOT NULL,
    "notifyTarget" "EscalationTarget" NOT NULL,
    "notifiedEmployeeId" TEXT,
    "activeMinutesAtFire" INTEGER NOT NULL,
    "firedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_systems" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "referenceUrlTemplate" TEXT,
    "webhookUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_systems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegations" (
    "id" TEXT NOT NULL,
    "fromEmployeeId" TEXT NOT NULL,
    "toEmployeeId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "taskTypeIds" TEXT[],
    "reason" TEXT NOT NULL,
    "madePermanentAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delegations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_checklists" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "exitDate" TIMESTAMP(3),
    "replacementEmployeeId" TEXT,
    "status" "ExitChecklistStatus" NOT NULL DEFAULT 'OPEN',
    "overrideReason" TEXT,
    "overrideByUserId" TEXT,
    "overriddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "exit_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exit_checklist_items" (
    "id" TEXT NOT NULL,
    "checklistId" TEXT NOT NULL,
    "itemType" "ExitItemType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isBlocking" BOOLEAN NOT NULL DEFAULT false,
    "transferredToEmployeeId" TEXT,
    "transferredAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exit_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sla_definitions_isActive_idx" ON "sla_definitions"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "escalation_rules_slaDefinitionId_level_key" ON "escalation_rules"("slaDefinitionId", "level");

-- CreateIndex
CREATE INDEX "task_escalations_taskId_idx" ON "task_escalations"("taskId");

-- CreateIndex
CREATE UNIQUE INDEX "task_escalations_taskId_level_key" ON "task_escalations"("taskId", "level");

-- CreateIndex
CREATE UNIQUE INDEX "source_systems_code_key" ON "source_systems"("code");

-- CreateIndex
CREATE INDEX "delegations_fromEmployeeId_startsAt_idx" ON "delegations"("fromEmployeeId", "startsAt");

-- CreateIndex
CREATE INDEX "delegations_endsAt_revertedAt_idx" ON "delegations"("endsAt", "revertedAt");

-- CreateIndex
CREATE UNIQUE INDEX "exit_checklists_employeeId_key" ON "exit_checklists"("employeeId");

-- CreateIndex
CREATE INDEX "exit_checklist_items_checklistId_isBlocking_idx" ON "exit_checklist_items"("checklistId", "isBlocking");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_sourceSystemId_sourceReference_key" ON "tasks"("sourceSystemId", "sourceReference");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_sourceSystemId_fkey" FOREIGN KEY ("sourceSystemId") REFERENCES "source_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_definitions" ADD CONSTRAINT "sla_definitions_taskTypeId_fkey" FOREIGN KEY ("taskTypeId") REFERENCES "task_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_definitions" ADD CONSTRAINT "sla_definitions_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_definitions" ADD CONSTRAINT "sla_definitions_sourceSystemId_fkey" FOREIGN KEY ("sourceSystemId") REFERENCES "source_systems"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_rules" ADD CONSTRAINT "escalation_rules_slaDefinitionId_fkey" FOREIGN KEY ("slaDefinitionId") REFERENCES "sla_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_escalations" ADD CONSTRAINT "task_escalations_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_fromEmployeeId_fkey" FOREIGN KEY ("fromEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delegations" ADD CONSTRAINT "delegations_toEmployeeId_fkey" FOREIGN KEY ("toEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_checklists" ADD CONSTRAINT "exit_checklists_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exit_checklist_items" ADD CONSTRAINT "exit_checklist_items_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "exit_checklists"("id") ON DELETE CASCADE ON UPDATE CASCADE;


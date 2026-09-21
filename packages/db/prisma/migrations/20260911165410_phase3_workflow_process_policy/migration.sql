-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ManualScope" AS ENUM ('DEPARTMENT', 'PROCESS', 'POLICY');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "workflowVersionId" TEXT;

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT,
    "ownerEmployeeId" TEXT NOT NULL,
    "approverEmployeeId" TEXT NOT NULL,
    "reviewFrequencyMonths" INTEGER NOT NULL DEFAULT 12,
    "reviewLeadTimeDays" INTEGER NOT NULL DEFAULT 20,
    "nextReviewDate" TIMESTAMP(3),
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "documentUrl" TEXT,
    "summary" TEXT,
    "status" "PolicyStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "controlObjective" TEXT,
    "ownerEmployeeId" TEXT NOT NULL,
    "policyId" TEXT,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewFrequencyMonths" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflows" (
    "id" TEXT NOT NULL,
    "deskCardActivityId" TEXT NOT NULL,
    "reviewFrequencyMonths" INTEGER NOT NULL DEFAULT 12,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedByUserId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "lastEditedByUserId" TEXT,
    "reviewDueAt" TIMESTAMP(3),
    "supersededAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_steps" (
    "id" TEXT NOT NULL,
    "workflowVersionId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "contentJson" JSONB,
    "attachmentUrls" TEXT[],
    "expectedMinutes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "operations_manuals" (
    "id" TEXT NOT NULL,
    "scopeType" "ManualScope" NOT NULL,
    "scopeId" TEXT NOT NULL,
    "scopeLabel" TEXT NOT NULL,
    "generatedByUserId" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activitiesInScope" INTEGER NOT NULL,
    "activitiesCovered" INTEGER NOT NULL,
    "staleWorkflows" INTEGER NOT NULL,
    "coveragePercent" INTEGER NOT NULL,
    "wasScopeLimited" BOOLEAN NOT NULL DEFAULT false,
    "contentJson" JSONB NOT NULL,

    CONSTRAINT "operations_manuals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policies_code_key" ON "policies"("code");

-- CreateIndex
CREATE INDEX "policies_status_idx" ON "policies"("status");

-- CreateIndex
CREATE INDEX "policy_versions_policyId_effectiveFrom_idx" ON "policy_versions"("policyId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_policyId_versionNumber_key" ON "policy_versions"("policyId", "versionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "processes_code_key" ON "processes"("code");

-- CreateIndex
CREATE INDEX "processes_policyId_idx" ON "processes"("policyId");

-- CreateIndex
CREATE UNIQUE INDEX "workflows_deskCardActivityId_key" ON "workflows"("deskCardActivityId");

-- CreateIndex
CREATE INDEX "workflow_versions_status_idx" ON "workflow_versions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_workflowId_versionNumber_key" ON "workflow_versions"("workflowId", "versionNumber");

-- CreateIndex
CREATE INDEX "workflow_steps_workflowVersionId_position_idx" ON "workflow_steps"("workflowVersionId", "position");

-- CreateIndex
CREATE INDEX "operations_manuals_scopeType_scopeId_idx" ON "operations_manuals"("scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "operations_manuals_generatedAt_idx" ON "operations_manuals"("generatedAt");

-- AddForeignKey
ALTER TABLE "desk_card_activities" ADD CONSTRAINT "desk_card_activities_processId_fkey" FOREIGN KEY ("processId") REFERENCES "processes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "workflow_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_approverEmployeeId_fkey" FOREIGN KEY ("approverEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_ownerEmployeeId_fkey" FOREIGN KEY ("ownerEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processes" ADD CONSTRAINT "processes_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_deskCardActivityId_fkey" FOREIGN KEY ("deskCardActivityId") REFERENCES "desk_card_activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_steps" ADD CONSTRAINT "workflow_steps_workflowVersionId_fkey" FOREIGN KEY ("workflowVersionId") REFERENCES "workflow_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;


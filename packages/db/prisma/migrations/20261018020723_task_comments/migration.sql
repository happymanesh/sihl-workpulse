-- CreateEnum
CREATE TYPE "TaskCommentKind" AS ENUM ('GENERAL', 'ACCEPTANCE', 'PROGRESS', 'COMPLETION', 'REVIEW');

-- CreateTable
CREATE TABLE "task_comments" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "authorEmployeeId" TEXT NOT NULL,
    "authorUserId" TEXT,
    "body" TEXT NOT NULL,
    "kind" "TaskCommentKind" NOT NULL DEFAULT 'GENERAL',
    "relatedStatus" "TaskStatus",
    "wasDictated" BOOLEAN NOT NULL DEFAULT false,
    "dictatedLanguage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "task_comments_taskId_createdAt_idx" ON "task_comments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "task_comments_authorEmployeeId_idx" ON "task_comments"("authorEmployeeId");

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_comments" ADD CONSTRAINT "task_comments_authorEmployeeId_fkey" FOREIGN KEY ("authorEmployeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

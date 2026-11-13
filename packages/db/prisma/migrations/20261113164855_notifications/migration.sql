-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('TASK_ASSIGNED', 'TASK_REVIEW_REQUESTED', 'TASK_VERIFIED', 'TASK_REJECTED', 'TASK_REOPENED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientEmployeeId" TEXT NOT NULL,
    "actorEmployeeId" TEXT,
    "kind" "NotificationKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipientEmployeeId_readAt_createdAt_idx" ON "notifications"("recipientEmployeeId", "readAt", "createdAt");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientEmployeeId_fkey" FOREIGN KEY ("recipientEmployeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actorEmployeeId_fkey" FOREIGN KEY ("actorEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

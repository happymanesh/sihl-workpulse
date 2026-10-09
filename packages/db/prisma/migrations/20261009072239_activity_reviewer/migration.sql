-- AlterTable
ALTER TABLE "desk_card_activities" ADD COLUMN     "reviewerEmployeeId" TEXT;

-- AddForeignKey
ALTER TABLE "desk_card_activities" ADD CONSTRAINT "desk_card_activities_reviewerEmployeeId_fkey" FOREIGN KEY ("reviewerEmployeeId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;

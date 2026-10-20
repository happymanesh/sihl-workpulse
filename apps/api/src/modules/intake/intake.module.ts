import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { IntakeController } from "./intake.controller";
import { IntakeService } from "./intake.service";

@Module({
  imports: [AuditModule],
  controllers: [IntakeController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}

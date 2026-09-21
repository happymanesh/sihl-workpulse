import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { IntakeService } from "./intake.service";

@Module({
  imports: [AuditModule],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}

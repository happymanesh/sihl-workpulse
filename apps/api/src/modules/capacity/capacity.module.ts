import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { CalendarService } from "./calendar.service";

@Module({
  imports: [AuditModule],
  providers: [CalendarService],
  exports: [CalendarService],
})
export class CapacityModule {}

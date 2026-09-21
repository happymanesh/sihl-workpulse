import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/audit.module";
import { SlaModule } from "../sla/sla.module";
import { CommandCentreController } from "./command-centre.controller";
import { CommandCentreJob } from "./command-centre.job";
import { CommandCentreService } from "./command-centre.service";

@Module({
  imports: [AuditModule, SlaModule],
  controllers: [CommandCentreController],
  providers: [CommandCentreService, CommandCentreJob],
  exports: [CommandCentreService],
})
export class CommandCentreModule {}

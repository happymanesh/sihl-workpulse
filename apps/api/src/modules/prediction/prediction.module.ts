import { Module } from "@nestjs/common";
import { SlaModule } from "../sla/sla.module";
import { PredictionJob } from "./prediction.job";
import { PredictionService } from "./prediction.service";

@Module({
  imports: [SlaModule],
  providers: [PredictionService, PredictionJob],
  exports: [PredictionService],
})
export class PredictionModule {}

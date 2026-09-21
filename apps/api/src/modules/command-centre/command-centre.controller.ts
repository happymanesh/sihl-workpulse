import { BadRequestException, Controller, Get, Query } from "@nestjs/common";
import { Roles } from "../auth/roles.decorator";
import { CommandCentreService } from "./command-centre.service";

/**
 * TM-FR-058: the integration surface for the CEO Command Centre.
 *
 * REST rather than tRPC on purpose. tRPC's value is end-to-end types for OUR
 * web client; this endpoint exists for a consumer built by someone else, on a
 * stack we do not control, possibly years from now. A plain, versioned,
 * cursor-paged JSON contract is the right shape for that, and is what the BRS
 * asks for ("a structured API/event feed").
 *
 * Restricted to INTEGRATION_SERVICE and the executive roles. Notably NOT
 * SYSTEM_ADMIN: administering workPulse is not a reason to hold the enterprise
 * status feed.
 */
@Controller("command-centre")
export class CommandCentreController {
  constructor(private readonly commandCentre: CommandCentreService) {}

  /**
   * Events after a cursor.
   *
   * The cursor is a STRING, not a number. `sequence` is a 64-bit value and a
   * cursor that silently lost precision past 2^53 would skip events without
   * anyone noticing - which is the one failure mode a feed must not have.
   */
  @Roles("INTEGRATION_SERVICE", "EXECUTIVE", "EXECUTIVE_RESTRICTED", "AUDIT")
  @Get("events")
  async events(
    @Query("since") since?: string,
    @Query("limit") limit?: string,
    @Query("includeResolved") includeResolved?: string,
  ) {
    let cursor: bigint | null = null;
    if (since !== undefined && since !== "") {
      try {
        cursor = BigInt(since);
      } catch {
        throw new BadRequestException("`since` must be a whole number, as returned in nextCursor");
      }
    }

    const parsedLimit = limit ? Number(limit) : 100;
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1) {
      throw new BadRequestException("`limit` must be a positive whole number");
    }

    return this.commandCentre.since(cursor, parsedLimit, includeResolved === "true");
  }

  /** Enterprise headline figures for a period, with direction of travel. */
  @Roles("INTEGRATION_SERVICE", "EXECUTIVE", "EXECUTIVE_RESTRICTED", "AUDIT")
  @Get("pulse")
  async pulse(@Query("periodStart") periodStart?: string, @Query("periodEnd") periodEnd?: string) {
    const now = new Date();
    const start = periodStart
      ? new Date(periodStart)
      : new Date(now.getFullYear(), now.getMonth(), 1);
    const end = periodEnd
      ? new Date(periodEnd)
      : new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new BadRequestException("`periodStart` and `periodEnd` must be ISO dates");
    }
    if (end <= start) {
      throw new BadRequestException("`periodEnd` must be after `periodStart`");
    }

    return this.commandCentre.pulse(start, end);
  }
}

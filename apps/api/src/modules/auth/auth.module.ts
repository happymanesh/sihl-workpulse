import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuditModule } from "../audit/audit.module";
import { RoleGrantService } from "./role-grant.service";
import { RoleMapService } from "./role-map.service";
import { IdentityService } from "./identity.service";
import { RolesGuard } from "./roles.guard";
import { SynapseAuthGuard } from "./synapse-auth.guard";
import { SynapseDirectoryService } from "./synapse-directory.service";
import { SynapseSessionService } from "./synapse-session.service";

/**
 * Identity is federated to Synapse (docs/synapse-integration.md). workPulse
 * verifies Synapse's session, re-checks that the user is still active, and maps
 * their Synapse roles onto workPulse roles. It issues nothing and stores no
 * credentials.
 */
@Module({
  imports: [AuditModule],
  providers: [
    SynapseSessionService,
    SynapseDirectoryService,
    IdentityService,
    RoleGrantService,
    RoleMapService,
    // Order matters: authentication before authorization on every request.
    { provide: APP_GUARD, useClass: SynapseAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
  exports: [SynapseSessionService, SynapseDirectoryService, IdentityService, RoleGrantService, RoleMapService],
})
export class AuthModule {}

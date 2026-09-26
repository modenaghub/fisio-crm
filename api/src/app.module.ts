import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { config } from './common/config';
import { PrismaModule } from './common/prisma.service';
import { CryptoModule } from './common/crypto.service';
import { PermissionSyncModule } from './common/permission-sync.service';
import { EventsModule } from './common/events';
import { JwtAuthGuard } from './common/auth/jwt-auth.guard';
import { PermissionsGuard } from './common/auth/permissions.guard';
import { IntegrationsModule } from './integrations/integrations.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { OrganizationModule } from './modules/organization/organization.module';
import { SystemModule } from './modules/system/system.module';
import { CrmModule } from './modules/crm/crm.module';
import { ClinicalModule } from './modules/clinical/clinical.module';
import { ScheduleModule } from './modules/schedule/schedule.module';

@Module({
  imports: [
    JwtModule.register({ global: true, secret: config.jwtSecret, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    PrismaModule,
    CryptoModule,
    PermissionSyncModule,
    EventsModule,
    IntegrationsModule,
    AuditModule,
    AuthModule,
    UsersModule,
    RolesModule,
    OrganizationModule,
    SystemModule,
    CrmModule,
    ClinicalModule,
    ScheduleModule,
  ],
  providers: [
    // Ordem importa: limite de requisições → autenticação → permissões.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
export class AppModule {}

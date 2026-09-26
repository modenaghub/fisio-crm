import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ProvisioningService } from '../organization/provisioning.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, ProvisioningService],
  exports: [AuthService, ProvisioningService],
})
export class AuthModule {}

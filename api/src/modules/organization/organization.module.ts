import { Module } from '@nestjs/common';
import { OnboardingController, SettingsController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({ controllers: [SettingsController, OnboardingController], providers: [OrganizationService], exports: [OrganizationService] })
export class OrganizationModule {}

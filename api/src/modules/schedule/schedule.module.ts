import { Module } from '@nestjs/common';
import { AppointmentsController, ScheduleController } from './schedule.controller';
import { ScheduleService } from './schedule.service';
import { AvailabilityService } from './availability.service';

@Module({ controllers: [AppointmentsController, ScheduleController], providers: [ScheduleService, AvailabilityService], exports: [ScheduleService, AvailabilityService] })
export class ScheduleModule {}

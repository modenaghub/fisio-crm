import { Module } from '@nestjs/common';
import { CrmController, LeadsController, PatientsController } from './crm.controller';
import { PatientsService } from './patients.service';
import { LeadsService } from './leads.service';

@Module({
  controllers: [PatientsController, LeadsController, CrmController],
  providers: [PatientsService, LeadsService],
  exports: [PatientsService, LeadsService],
})
export class CrmModule {}

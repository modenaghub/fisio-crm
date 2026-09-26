import { Body, Controller, Delete, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { BillingService } from '../finance/billing.service';
import { ClinicalService } from './clinical.service';
import {
  ClinicalProfileDto,
  ConditionDto,
  DeleteReasonDto,
  EditEvolutionDto,
  EvaluationDto,
  RegisterSessionDto,
  TreatmentPlanDto,
  UpdateConditionDto,
  UpdateEvaluationDto,
  UpdateTreatmentPlanDto,
} from './clinical.dto';

class SessionsQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsUUID() professionalId?: string;
}
class SearchQ {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
}

@Controller('patients/:patientId')
export class PatientClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @RequirePermissions('clinical.read')
  @Get('clinical-profile')
  profile(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string) {
    return this.clinical.getProfile(ctx, pid);
  }

  @RequirePermissions('clinical.write')
  @Put('clinical-profile')
  saveProfile(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Body() dto: ClinicalProfileDto) {
    return this.clinical.saveProfile(ctx, pid, dto);
  }

  @RequirePermissions('clinical.write')
  @Post('conditions')
  addCondition(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Body() dto: ConditionDto) {
    return this.clinical.addCondition(ctx, pid, dto);
  }

  @RequirePermissions('clinical.write')
  @Patch('conditions/:id')
  updateCondition(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateConditionDto) {
    return this.clinical.updateCondition(ctx, pid, id, dto);
  }

  @RequirePermissions('clinical.write')
  @HttpCode(204)
  @Delete('conditions/:id')
  removeCondition(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.clinical.removeCondition(ctx, pid, id);
  }

  @RequirePermissions('clinical.read')
  @Get('evaluations')
  evaluations(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string) {
    return this.clinical.listEvaluations(ctx, pid);
  }

  @RequirePermissions('clinical.write')
  @Post('evaluations')
  createEvaluation(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Body() dto: EvaluationDto) {
    return this.clinical.createEvaluation(ctx, pid, dto);
  }

  @RequirePermissions('clinical.write')
  @Patch('evaluations/:id')
  updateEvaluation(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEvaluationDto) {
    return this.clinical.updateEvaluation(ctx, pid, id, dto);
  }

  @RequirePermissions('clinical.delete')
  @HttpCode(204)
  @Delete('evaluations/:id')
  deleteEvaluation(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteReasonDto) {
    return this.clinical.deleteEvaluation(ctx, pid, id, dto.reason);
  }

  @RequirePermissions('clinical.read')
  @Get('treatment-plans')
  plans(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string) {
    return this.clinical.listPlans(ctx, pid);
  }

  @RequirePermissions('clinical.write')
  @Post('treatment-plans')
  createPlan(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Body() dto: TreatmentPlanDto) {
    return this.clinical.createPlan(ctx, pid, dto);
  }

  @RequirePermissions('clinical.write')
  @Patch('treatment-plans/:id')
  updatePlan(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTreatmentPlanDto) {
    return this.clinical.updatePlan(ctx, pid, id, dto);
  }

  @RequirePermissions('clinical.read')
  @Get('sessions')
  sessions(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string) {
    return this.clinical.listSessions(ctx, pid);
  }

  @RequirePermissions('clinical.write')
  @Post('sessions')
  registerSession(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Body() dto: RegisterSessionDto) {
    return this.clinical.registerSession(ctx, pid, dto);
  }
}

@Controller('clinical')
export class ClinicalController {
  constructor(private readonly clinical: ClinicalService) {}

  @RequirePermissions('clinical.read')
  @Get('sessions')
  recent(@Ctx() ctx: RequestContext, @Query() q: SessionsQuery) {
    return this.clinical.recentSessions(ctx, q);
  }

  @RequirePermissions('clinical.read')
  @Get('overview')
  overview(@Ctx() ctx: RequestContext, @Query() q: SearchQ) {
    return this.clinical.overview(ctx, q.q);
  }

  @RequirePermissions('clinical.read')
  @Get('conditions-catalog')
  catalog(@Ctx() ctx: RequestContext, @Query() q: SearchQ) {
    return this.clinical.conditionsCatalog(ctx, q.q);
  }

  @RequirePermissions('clinical.write')
  @Patch('sessions/:id/evolution')
  edit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EditEvolutionDto) {
    return this.clinical.editEvolution(ctx, id, dto);
  }

  @RequirePermissions('clinical.read')
  @Get('sessions/:id/versions')
  versions(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.clinical.versions(ctx, id);
  }

  @RequirePermissions('clinical.delete')
  @HttpCode(204)
  @Delete('sessions/:id')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeleteReasonDto) {
    return this.clinical.deleteSession(ctx, id, dto.reason);
  }
}

@Module({ controllers: [PatientClinicalController, ClinicalController], providers: [ClinicalService, BillingService], exports: [ClinicalService] })
export class ClinicalModule {}

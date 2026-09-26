import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { LeadStage } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { ConvertLeadDto, LeadDto, ListPatientsQuery, LostLeadDto, PatientDto, SearchQuery, StageDto, UpdateLeadDto, UpdatePatientDto } from './crm.dto';
import { PatientsService } from './patients.service';
import { LeadsService } from './leads.service';

class ListLeadsQuery {
  @IsOptional() @IsEnum(LeadStage) stage?: LeadStage;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

class BoardQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() responsibleId?: string;
}

@Controller('patients')
export class PatientsController {
  constructor(private readonly patients: PatientsService) {}

  @RequirePermissions('patients.read')
  @Get()
  list(@Ctx() ctx: RequestContext, @Query() q: ListPatientsQuery) {
    return this.patients.list(ctx, q);
  }

  @RequirePermissions('patients.read')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.get(ctx, id);
  }

  @RequirePermissions('patients.read')
  @Get(':id/timeline')
  timeline(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.timeline(ctx, id);
  }

  @RequirePermissions('patients.write')
  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: PatientDto) {
    return this.patients.createAndGet(ctx, dto);
  }

  @RequirePermissions('patients.write')
  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePatientDto) {
    return this.patients.update(ctx, id, dto);
  }

  @RequirePermissions('patients.write')
  @Patch(':id/stage')
  stage(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StageDto) {
    return this.patients.setStage(ctx, id, dto.stage);
  }

  @RequirePermissions('patients.delete')
  @HttpCode(204)
  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.patients.remove(ctx, id);
  }
}

@Controller('leads')
export class LeadsController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermissions('leads.read')
  @Get()
  list(@Ctx() ctx: RequestContext, @Query() q: ListLeadsQuery) {
    return this.leads.list(ctx, q);
  }

  @RequirePermissions('leads.read')
  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(ctx, id);
  }

  @RequirePermissions('leads.write')
  @Post()
  create(@Ctx() ctx: RequestContext, @Body() dto: LeadDto) {
    return this.leads.create(ctx, dto);
  }

  @RequirePermissions('leads.write')
  @Patch(':id')
  update(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateLeadDto) {
    return this.leads.update(ctx, id, dto);
  }

  @RequirePermissions('leads.write')
  @Patch(':id/stage')
  stage(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: StageDto) {
    return this.leads.setStage(ctx, id, dto.stage, dto.position);
  }

  @RequirePermissions('leads.write')
  @Post(':id/lost')
  lost(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: LostLeadDto) {
    return this.leads.markLost(ctx, id, dto.reason);
  }

  @RequirePermissions('leads.write')
  @Post(':id/reopen')
  reopen(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.reopen(ctx, id);
  }

  @RequirePermissions('leads.write', 'patients.write')
  @Post(':id/convert')
  convert(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertLeadDto) {
    return this.leads.convert(ctx, id, dto);
  }

  @RequirePermissions('leads.write')
  @HttpCode(204)
  @Delete(':id')
  remove(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.remove(ctx, id);
  }
}

@Controller()
export class CrmController {
  constructor(private readonly leads: LeadsService) {}

  @RequirePermissions('patients.read')
  @Get('crm/board')
  board(@Ctx() ctx: RequestContext, @Query() q: BoardQuery) {
    return this.leads.board(ctx, q);
  }

  @RequirePermissions('patients.read')
  @Get('search')
  search(@Ctx() ctx: RequestContext, @Query() q: SearchQuery) {
    return this.leads.search(ctx, q.q);
  }
}

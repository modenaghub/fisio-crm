import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { OrganizationService } from './organization.service';
import { HoursStepDto, ServicesStepDto, UnitDto, UpdateSettingsDto } from './organization.dto';

@Controller('settings')
export class SettingsController {
  constructor(private readonly org: OrganizationService) {}

  @RequirePermissions('settings.manage')
  @Get()
  get(@Ctx() ctx: RequestContext) {
    return this.org.getSettings(ctx);
  }

  @RequirePermissions('settings.manage')
  @Patch()
  update(@Ctx() ctx: RequestContext, @Body() dto: UpdateSettingsDto) {
    return this.org.updateSettings(ctx, dto);
  }

  // Leitura liberada a qualquer usuário autenticado: agenda e cadastros precisam destes dados.
  @Get('hours')
  hours(@Ctx() ctx: RequestContext) {
    return this.org.getHours(ctx);
  }

  @RequirePermissions('schedule.availability')
  @Put('hours')
  saveHours(@Ctx() ctx: RequestContext, @Body() dto: HoursStepDto) {
    return this.org.saveHoursStandalone(ctx, dto);
  }

  @Get('services')
  services(@Ctx() ctx: RequestContext) {
    return this.org.listServices(ctx);
  }

  @RequirePermissions('settings.manage')
  @Put('services')
  saveServices(@Ctx() ctx: RequestContext, @Body() dto: ServicesStepDto) {
    return this.org.saveServicesStandalone(ctx, dto);
  }

  @Get('units')
  units(@Ctx() ctx: RequestContext) {
    return this.org.listUnits(ctx);
  }

  @RequirePermissions('settings.manage')
  @Post('units')
  createUnit(@Ctx() ctx: RequestContext, @Body() dto: UnitDto) {
    return this.org.createUnit(ctx, dto);
  }

  @RequirePermissions('settings.manage')
  @Patch('units/:id')
  updateUnit(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UnitDto) {
    return this.org.updateUnit(ctx, id, dto);
  }
}

@Controller('onboarding')
@RequirePermissions('settings.manage')
export class OnboardingController {
  constructor(private readonly org: OrganizationService) {}

  @Get()
  get(@Ctx() ctx: RequestContext) {
    return this.org.getOnboarding(ctx);
  }

  /** O corpo é validado dentro do serviço com o DTO específico de cada etapa. */
  @Put('steps/:step')
  save(@Ctx() ctx: RequestContext, @Param('step', ParseIntPipe) step: number, @Body() body: unknown) {
    return this.org.saveOnboardingStep(ctx, step, body);
  }

  @HttpCode(200)
  @Post('complete')
  complete(@Ctx() ctx: RequestContext) {
    return this.org.completeOnboarding(ctx);
  }
}

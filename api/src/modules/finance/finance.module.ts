import { Body, Controller, Get, HttpCode, Module, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { IsIn, IsOptional } from 'class-validator';
import { Ctx, RequirePermissions } from '../../common/auth/decorators';
import type { RequestContext } from '../../common/auth/auth.types';
import { ScheduleModule } from '../schedule/schedule.module';
import { BillingService } from './billing.service';
import { FinanceService } from './finance.service';
import {
  CancelDto,
  CategoryDto,
  ExpenseDto,
  GoalsDto,
  ListExpensesQuery,
  ListReceivablesQuery,
  MonthQuery,
  PackageTemplateDto,
  PayDto,
  PeriodQuery,
  ReceivableDto,
  SellPackageDto,
  UpdateExpenseDto,
  UpdatePackageDto,
  UpdatePackageTemplateDto,
  UpdateReceivableDto,
} from './finance.dto';

class PackagesQuery {
  @IsOptional() @IsIn(['ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED']) status?: string;
}

@Controller('finance')
export class FinanceController {
  constructor(private readonly finance: FinanceService) {}

  // modelos de pacote
  @RequirePermissions('finance.read')
  @Get('package-templates')
  templates(@Ctx() ctx: RequestContext) {
    return this.finance.listTemplates(ctx);
  }

  @RequirePermissions('settings.manage')
  @Post('package-templates')
  createTemplate(@Ctx() ctx: RequestContext, @Body() dto: PackageTemplateDto) {
    return this.finance.createTemplate(ctx, dto);
  }

  @RequirePermissions('settings.manage')
  @Patch('package-templates/:id')
  updateTemplate(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePackageTemplateDto) {
    return this.finance.updateTemplate(ctx, id, dto);
  }

  // pacotes
  @RequirePermissions('finance.read')
  @Get('packages')
  packages(@Ctx() ctx: RequestContext, @Query() q: PackagesQuery) {
    return this.finance.listPackages(ctx, q.status);
  }

  @RequirePermissions('finance.write')
  @Patch('packages/:id')
  updatePackage(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePackageDto) {
    return this.finance.updatePackage(ctx, id, dto);
  }

  // contas a receber
  @RequirePermissions('finance.read')
  @Get('receivables')
  receivables(@Ctx() ctx: RequestContext, @Query() q: ListReceivablesQuery) {
    return this.finance.listReceivables(ctx, q);
  }

  @RequirePermissions('finance.read')
  @Get('receivables/:id')
  receivable(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.finance.getReceivable(ctx, id);
  }

  @RequirePermissions('finance.write')
  @Post('receivables')
  createReceivable(@Ctx() ctx: RequestContext, @Body() dto: ReceivableDto) {
    return this.finance.createReceivable(ctx, dto);
  }

  @RequirePermissions('finance.write')
  @Patch('receivables/:id')
  updateReceivable(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateReceivableDto) {
    return this.finance.updateReceivable(ctx, id, dto);
  }

  @RequirePermissions('finance.write')
  @HttpCode(200)
  @Post('receivables/:id/pay')
  pay(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.finance.pay(ctx, id, dto);
  }

  @RequirePermissions('finance.write')
  @HttpCode(200)
  @Post('receivables/:id/cancel')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.finance.cancelReceivable(ctx, id, dto.reason);
  }

  // despesas
  @RequirePermissions('finance.reports')
  @Get('expense-categories')
  categories(@Ctx() ctx: RequestContext) {
    return this.finance.listCategories(ctx);
  }

  @RequirePermissions('finance.reports', 'finance.write')
  @Post('expense-categories')
  createCategory(@Ctx() ctx: RequestContext, @Body() dto: CategoryDto) {
    return this.finance.createCategory(ctx, dto.name);
  }

  @RequirePermissions('finance.reports')
  @Get('expenses')
  expenses(@Ctx() ctx: RequestContext, @Query() q: ListExpensesQuery) {
    return this.finance.listExpenses(ctx, q);
  }

  @RequirePermissions('finance.reports', 'finance.write')
  @Post('expenses')
  createExpense(@Ctx() ctx: RequestContext, @Body() dto: ExpenseDto) {
    return this.finance.createExpense(ctx, dto);
  }

  @RequirePermissions('finance.reports', 'finance.write')
  @Patch('expenses/:id')
  updateExpense(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateExpenseDto) {
    return this.finance.updateExpense(ctx, id, dto);
  }

  @RequirePermissions('finance.reports', 'finance.write')
  @HttpCode(200)
  @Post('expenses/:id/pay')
  payExpense(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: PayDto) {
    return this.finance.payExpense(ctx, id, dto);
  }

  @RequirePermissions('finance.reports', 'finance.write')
  @HttpCode(204)
  @Post('expenses/:id/cancel')
  cancelExpense(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelDto) {
    return this.finance.cancelExpense(ctx, id, dto.reason);
  }

  // caixa, resumo, projeção e metas
  @RequirePermissions('finance.reports')
  @Get('transactions')
  transactions(@Ctx() ctx: RequestContext, @Query() q: PeriodQuery) {
    return this.finance.transactions(ctx, q.from, q.to);
  }

  @RequirePermissions('finance.reports')
  @Get('summary')
  summary(@Ctx() ctx: RequestContext, @Query() q: PeriodQuery) {
    return this.finance.summary(ctx, q.from, q.to);
  }

  @RequirePermissions('finance.reports')
  @Get('monthly')
  monthly(@Ctx() ctx: RequestContext) {
    return this.finance.monthly(ctx, 6);
  }

  @RequirePermissions('finance.reports')
  @Get('projection')
  projection(@Ctx() ctx: RequestContext) {
    return this.finance.projection(ctx);
  }

  @RequirePermissions('dashboard.view')
  @Get('goals')
  goals(@Ctx() ctx: RequestContext, @Query() q: MonthQuery) {
    return this.finance.goals(ctx, q.month);
  }

  @RequirePermissions('settings.manage')
  @Put('goals')
  saveGoals(@Ctx() ctx: RequestContext, @Body() dto: GoalsDto) {
    return this.finance.saveGoals(ctx, dto);
  }
}

@Controller('patients/:patientId/packages')
export class PatientPackagesController {
  constructor(private readonly finance: FinanceService) {}

  @RequirePermissions('patients.read')
  @Get()
  list(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string) {
    return this.finance.patientPackages(ctx, pid);
  }

  @RequirePermissions('finance.write')
  @Post()
  sell(@Ctx() ctx: RequestContext, @Param('patientId', ParseUUIDPipe) pid: string, @Body() dto: SellPackageDto) {
    return this.finance.sellPackage(ctx, pid, dto);
  }
}

@Module({
  imports: [ScheduleModule],
  controllers: [FinanceController, PatientPackagesController],
  providers: [FinanceService, BillingService],
  exports: [FinanceService, BillingService],
})
export class FinanceModule {}

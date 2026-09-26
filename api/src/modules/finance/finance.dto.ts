import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaymentMethod, RevenueKind } from '@prisma/client';
import { emptyToNull, trim } from '../../common/helpers';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class PackageTemplateDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name: string;
  @IsInt() @Min(1) @Max(500) sessions: number;
  @IsInt() @Min(0) @Max(100_000_000) priceCents: number;
  @IsOptional() @IsInt() @Min(1) @Max(3650) validityDays?: number | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdatePackageTemplateDto extends PartialType(PackageTemplateDto) {}

export class SellPackageDto {
  @IsOptional() @IsUUID() templateId?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(500) sessions?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100_000_000) totalPriceCents?: number;
  @Matches(DATE, { message: 'Data de início inválida' }) startDate: string;
  @IsOptional() @Matches(DATE) expectedEndDate?: string;
  /** Parcelamento: 1 a 12 parcelas mensais. */
  @IsOptional() @IsInt() @Min(1) @Max(12) installments?: number;
  @IsOptional() @Matches(DATE) firstDueDate?: string;
  /** Se já pago no ato, registra o recebimento da 1ª parcela (ou do total, se à vista). */
  @IsOptional() @IsEnum(PaymentMethod) paidNowMethod?: PaymentMethod;
}

export class UpdatePackageDto {
  @IsOptional() @IsIn(['ACTIVE', 'CANCELLED', 'EXPIRED', 'COMPLETED']) status?: 'ACTIVE' | 'CANCELLED' | 'EXPIRED' | 'COMPLETED';
  @IsOptional() @Matches(DATE) expectedEndDate?: string;
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(80) name?: string;
}

export class ReceivableDto {
  @IsOptional() @IsUUID() patientId?: string;
  @IsOptional() @IsEnum(RevenueKind) kind?: RevenueKind;
  @Transform(trim) @IsString() @MinLength(2, { message: 'Descreva a cobrança' }) @MaxLength(200) description: string;
  @IsInt({ message: 'Informe o valor' }) @Min(1, { message: 'Informe o valor' }) @Max(100_000_000) amountCents: number;
  @Matches(DATE, { message: 'Vencimento inválido' }) dueDate: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;
}

export class UpdateReceivableDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(200) description?: string;
  @IsOptional() @IsInt() @Min(1) @Max(100_000_000) amountCents?: number;
  @IsOptional() @Matches(DATE) dueDate?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;
}

export class PayDto {
  @IsInt({ message: 'Informe o valor recebido' }) @Min(1) @Max(100_000_000) amountCents: number;
  @IsEnum(PaymentMethod, { message: 'Informe a forma de pagamento' }) method: PaymentMethod;
  @IsOptional() @IsDateString() paidAt?: string;
}

export class CancelDto {
  @Transform(trim) @IsString() @MinLength(3, { message: 'Informe o motivo' }) @MaxLength(300) reason: string;
}

export class ListReceivablesQuery {
  @IsOptional() @IsIn(['PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'CANCELLED', 'OPEN']) status?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @IsUUID() patientId?: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @IsEnum(RevenueKind) kind?: RevenueKind;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) pageSize?: number;
}

export class ExpenseDto {
  @IsUUID('all', { message: 'Escolha a categoria' }) categoryId: string;
  @Transform(trim) @IsString() @MinLength(2, { message: 'Descreva a despesa' }) @MaxLength(200) description: string;
  @IsInt({ message: 'Informe o valor' }) @Min(1, { message: 'Informe o valor' }) @Max(100_000_000) amountCents: number;
  @Matches(DATE, { message: 'Vencimento inválido' }) dueDate: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120) supplier?: string | null;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
  /** Repetir mensalmente por N meses (gera N lançamentos). */
  @IsOptional() @IsInt() @Min(1) @Max(24) repeatMonths?: number;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500) notes?: string | null;
  @IsOptional() @IsEnum(PaymentMethod) paidNowMethod?: PaymentMethod;
}
export class UpdateExpenseDto extends PartialType(ExpenseDto) {}

export class ListExpensesQuery {
  @IsOptional() @IsIn(['PENDING', 'PAID', 'PARTIAL', 'OVERDUE', 'CANCELLED', 'OPEN']) status?: string;
  @IsOptional() @Matches(DATE) from?: string;
  @IsOptional() @Matches(DATE) to?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

export class CategoryDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(60) name: string;
}

export class PeriodQuery {
  @Matches(DATE) from: string;
  @Matches(DATE) to: string;
}

export class GoalsDto {
  @Matches(/^\d{4}-\d{2}$/, { message: 'Mês inválido' }) month: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) revenueCents?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) sessions?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100_000) newPatients?: number | null;
}

export class MonthQuery {
  @IsOptional() @Matches(/^\d{4}-\d{2}$/) month?: string;
}

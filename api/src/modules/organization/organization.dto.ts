import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { PaymentMethod, ServiceKind } from '@prisma/client';
import { TIME_REGEX } from '../../common/validators';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim()) : value;

const UF = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const PHONE_REGEX = /^\+?[\d\s()-]{10,20}$/;

// ───────── Configurações da clínica ─────────

export class UpdateSettingsDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(2) @MaxLength(120)
  clinicName?: string;

  @IsOptional() @Transform(emptyToUndefined) @Matches(PHONE_REGEX, { message: 'Telefone inválido' })
  phone?: string;

  @IsOptional() @Transform(emptyToUndefined) @Matches(PHONE_REGEX, { message: 'WhatsApp inválido' })
  whatsapp?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(200)
  addressLine?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(80)
  city?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsIn(UF, { message: 'UF inválida' })
  state?: string;

  @IsOptional() @Transform(emptyToUndefined) @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido' })
  zipCode?: string;

  @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  defaultSessionPriceCents?: number;

  @IsOptional() @IsInt() @Min(10) @Max(240)
  defaultSessionMinutes?: number;

  @IsOptional() @IsInt() @Min(0) @Max(168)
  minBookingNoticeHours?: number;

  @IsOptional() @IsInt() @Min(0) @Max(168)
  cancellationNoticeHours?: number;

  @IsOptional() @IsBoolean()
  allowOverbooking?: boolean;

  @IsOptional() @IsInt() @Min(1) @Max(180)
  noShowFollowUpDays?: number;

  @IsOptional() @IsArray() @IsEnum(PaymentMethod, { each: true })
  acceptedPaymentMethods?: PaymentMethod[];
}

// ───────── Onboarding: um DTO por etapa ─────────

export class ClinicStepDto {
  @Transform(trim) @IsString() @MinLength(2, { message: 'Informe o nome da clínica' }) @MaxLength(120)
  clinicName: string;
}

export class ProfessionalStepDto {
  @Transform(trim) @IsString() @MinLength(3, { message: 'Informe o nome do fisioterapeuta' }) @MaxLength(120)
  name: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(30)
  crefito?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  specialties?: string[];
}

export class LogoStepDto {
  /** Imagem PNG/JPEG/WebP em data URL (até ~300 KB). null remove o logo. Troca por storage S3 na Fase 10. */
  @ValidateIf((o) => o.logoDataUrl !== null)
  @IsString()
  @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, { message: 'Envie uma imagem PNG, JPG ou WebP' })
  @MaxLength(420_000, { message: 'A imagem deve ter no máximo 300 KB' })
  logoDataUrl: string | null;
}

export class ContactStepDto {
  @Transform(trim) @Matches(PHONE_REGEX, { message: 'Telefone inválido' })
  phone: string;

  @IsOptional() @Transform(emptyToUndefined) @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(200)
  addressLine?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(80)
  city?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsIn(UF, { message: 'UF inválida' })
  state?: string;

  @IsOptional() @Transform(emptyToUndefined) @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido' })
  zipCode?: string;
}

export class TimeIntervalDto {
  @Matches(TIME_REGEX, { message: 'Horário inválido (use HH:MM)' })
  start: string;

  @Matches(TIME_REGEX, { message: 'Horário inválido (use HH:MM)' })
  end: string;
}

export class DayHoursDto {
  @IsInt() @Min(0) @Max(6)
  weekday: number;

  @IsArray() @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => TimeIntervalDto)
  intervals: TimeIntervalDto[];
}

export class HoursStepDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => DayHoursDto)
  days: DayHoursDto[];
}

export class PricingStepDto {
  @IsInt({ message: 'Informe o valor da sessão' }) @Min(0) @Max(10_000_000)
  defaultSessionPriceCents: number;

  @IsInt() @Min(10) @Max(240)
  defaultSessionMinutes: number;

  @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  evaluationPriceCents?: number;
}

export class ServiceItemDto {
  @IsOptional() @IsUUID()
  id?: string;

  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @IsEnum(ServiceKind)
  kind: ServiceKind;

  @IsInt() @Min(5) @Max(480)
  durationMinutes: number;

  @IsInt() @Min(0) @Max(10_000_000)
  priceCents: number;
}

export class ServicesStepDto {
  @IsArray() @ArrayMinSize(1, { message: 'Cadastre ao menos um serviço' }) @ArrayMaxSize(50)
  @ValidateNested({ each: true }) @Type(() => ServiceItemDto)
  services: ServiceItemDto[];
}

export class WhatsAppStepDto {
  @IsOptional() @Transform(emptyToUndefined) @Matches(PHONE_REGEX, { message: 'WhatsApp inválido' })
  whatsapp?: string;
}

export class FinanceStepDto {
  @IsArray() @ArrayMinSize(1, { message: 'Selecione ao menos uma forma de pagamento' }) @IsEnum(PaymentMethod, { each: true })
  acceptedPaymentMethods: PaymentMethod[];

  @IsArray() @ArrayMaxSize(40) @IsString({ each: true })
  expenseCategories: string[];
}

export const ONBOARDING_STEPS = {
  1: ClinicStepDto,
  2: ProfessionalStepDto,
  3: LogoStepDto,
  4: ContactStepDto,
  5: HoursStepDto,
  6: PricingStepDto,
  7: ServicesStepDto,
  8: WhatsAppStepDto,
  9: FinanceStepDto,
} as const;

export type OnboardingStep = keyof typeof ONBOARDING_STEPS;

export class UnitDto {
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(80)
  name: string;

  @IsOptional() @Transform(emptyToUndefined) @Matches(PHONE_REGEX, { message: 'Telefone inválido' })
  phone?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(200)
  addressLine?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(80)
  city?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsIn(UF, { message: 'UF inválida' })
  state?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

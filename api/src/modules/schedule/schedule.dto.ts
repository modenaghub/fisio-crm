import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
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
  ValidateNested,
} from 'class-validator';
import { AvailabilityExceptionKind } from '@prisma/client';
import { emptyToNull, trim } from '../../common/helpers';
import { TIME_REGEX } from '../../common/validators';
import { DayHoursDto } from '../organization/organization.dto';

export class AppointmentDto {
  @IsOptional() @IsIn(['APPOINTMENT', 'BLOCK'])
  kind?: 'APPOINTMENT' | 'BLOCK';

  @IsOptional() @IsUUID()
  patientId?: string;

  @IsUUID('all', { message: 'Selecione o profissional' })
  professionalId: string;

  @IsOptional() @IsUUID()
  serviceId?: string;

  @IsOptional() @IsUUID()
  unitId?: string;

  @IsOptional() @IsUUID()
  packageId?: string;

  @IsDateString({}, { message: 'Data/hora inválida' })
  startsAt: string;

  @IsOptional() @IsInt() @Min(5) @Max(720)
  durationMinutes?: number;

  @IsOptional() @IsInt() @Min(0) @Max(10_000_000)
  priceCents?: number;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000)
  notes?: string | null;

  /** Permite agendar fora do horário de atendimento (atendimento extraordinário) ou encaixar, se a clínica permitir. */
  @IsOptional() @IsBoolean()
  force?: boolean;
}

export class MoveAppointmentDto {
  @IsOptional() @IsDateString() startsAt?: string;
  @IsOptional() @IsInt() @Min(5) @Max(720) durationMinutes?: number;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsBoolean() force?: boolean;
}

export class StatusDto {
  @IsIn(['SCHEDULED', 'CONFIRMED', 'IN_PROGRESS', 'CANCELLED', 'NO_SHOW'], { message: 'Status inválido' })
  status: 'SCHEDULED' | 'CONFIRMED' | 'IN_PROGRESS' | 'CANCELLED' | 'NO_SHOW';

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300)
  reason?: string | null;

  @IsOptional() @IsString() @MaxLength(40)
  channel?: string;
}

export class RescheduleDto {
  @IsDateString() startsAt: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional() @IsInt() @Min(5) @Max(720) durationMinutes?: number;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(300) reason?: string | null;
  @IsOptional() @IsBoolean() force?: boolean;
}

export class RecurringDto {
  @IsUUID() patientId: string;
  @IsUUID() professionalId: string;
  @IsOptional() @IsUUID() serviceId?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @IsUUID() packageId?: string;

  @IsArray() @ArrayMinSize(1, { message: 'Escolha ao menos um dia da semana' }) @ArrayMaxSize(7) @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true })
  weekdays: number[];

  @Matches(TIME_REGEX, { message: 'Horário inválido' })
  time: string;

  @IsOptional() @IsInt() @Min(5) @Max(720)
  durationMinutes?: number;

  @IsDateString() startDate: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) occurrences?: number;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
  @IsOptional() @IsBoolean() dryRun?: boolean;
  /** Cria as sessões sem conflito e ignora as demais. */
  @IsOptional() @IsBoolean() skipConflicts?: boolean;
  @IsOptional() @IsBoolean() force?: boolean;
}

export class RangeQuery {
  @IsDateString() from: string;
  @IsDateString() to: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional() @IsUUID() unitId?: string;
}

export class SlotsQuery {
  @IsUUID() professionalId: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(5) @Max(720) durationMinutes?: number;
  @IsOptional() @IsUUID() unitId?: string;
}

export class ExceptionDto {
  @IsEnum(AvailabilityExceptionKind) kind: AvailabilityExceptionKind;
  @IsDateString() startsAt: string;
  @IsDateString() endsAt: string;
  @IsOptional() @IsUUID() professionalId?: string;
  @IsOptional() @IsUUID() unitId?: string;
  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(200) reason?: string | null;
}

export class HolidayDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data inválida' }) date: string;
  @Transform(trim) @IsString() @MinLength(2) @MaxLength(100) name: string;
  @IsOptional() @IsBoolean() isRecurring?: boolean;
}

export class NationalHolidaysDto {
  @IsInt() @Min(2020) @Max(2100) year: number;
}

export class ProfessionalHoursDto {
  /** Lista vazia = o profissional segue o horário da unidade. */
  @IsArray() @ArrayMaxSize(7) @ValidateNested({ each: true }) @Type(() => DayHoursDto)
  days: DayHoursDto[];
}

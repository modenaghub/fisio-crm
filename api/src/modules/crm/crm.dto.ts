import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { LeadSource, LeadStage, LeadTemperature, PatientStage, Sex } from '@prisma/client';
import { IsCpf } from '../../common/validators';
import { emptyToNull, emptyToUndefined, trim } from '../../common/helpers';

const UF = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];
const PHONE = /^\+?[\d\s()-]{10,20}$/;

export class PatientDto {
  @Transform(trim) @IsString() @MinLength(3, { message: 'Informe o nome completo' }) @MaxLength(150)
  name: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(150)
  socialName?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsCpf()
  cpf?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsDateString({}, { message: 'Data de nascimento inválida' })
  birthDate?: string | null;

  @IsOptional() @IsEnum(Sex)
  sex?: Sex;

  @IsOptional() @Transform(emptyToNull) @Matches(PHONE, { message: 'Telefone inválido' })
  phone?: string | null;

  @IsOptional() @Transform(emptyToNull) @Matches(PHONE, { message: 'WhatsApp inválido' })
  whatsapp?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsEmail({}, { message: 'E-mail inválido' })
  email?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(100)
  profession?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(200)
  addressLine?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(80)
  city?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsIn([...UF, null], { message: 'UF inválida' })
  state?: string | null;

  @IsOptional() @Transform(emptyToNull) @Matches(/^\d{5}-?\d{3}$/, { message: 'CEP inválido' })
  zipCode?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120)
  emergencyContactName?: string | null;

  @IsOptional() @Transform(emptyToNull) @Matches(PHONE, { message: 'Telefone de emergência inválido' })
  emergencyContactPhone?: string | null;

  @IsOptional() @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional() @IsEnum(PatientStage)
  crmStage?: PatientStage;

  @IsOptional() @Transform(emptyToNull) @IsUUID()
  responsibleId?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(2000)
  notes?: string | null;

  /** Foto em data URL (até ~200 KB). */
  @IsOptional() @Transform(emptyToNull)
  @Matches(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, { message: 'Foto inválida' })
  @MaxLength(280_000, { message: 'A foto deve ter no máximo 200 KB' })
  photoUrl?: string | null;

  /** Consentimento LGPD para tratamento de dados de saúde, registrado na criação. */
  @IsOptional() @IsBoolean()
  healthDataConsent?: boolean;
}

export class UpdatePatientDto extends PartialType(PatientDto) {}

export class StageDto {
  @IsString()
  stage: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  position?: number;
}

export class ListPatientsQuery {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsEnum(PatientStage) stage?: PatientStage;
  @IsOptional() @IsUUID() responsibleId?: string;
  @IsOptional() @IsIn(['name', 'recent', 'code']) sort?: 'name' | 'recent' | 'code';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) pageSize?: number;
}

export class LeadDto {
  @Transform(trim) @IsString() @MinLength(2, { message: 'Informe o nome' }) @MaxLength(150)
  name: string;

  @Transform(trim) @Matches(PHONE, { message: 'Telefone inválido' })
  phone: string;

  @IsOptional() @Transform(emptyToNull) @IsEmail({}, { message: 'E-mail inválido' })
  email?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsCpf()
  cpf?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsDateString({}, { message: 'Data de nascimento inválida' })
  birthDate?: string | null;

  @IsOptional() @IsEnum(LeadSource)
  source?: LeadSource;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120)
  sourceDetail?: string | null;

  @IsOptional() @IsEnum(LeadStage)
  stage?: LeadStage;

  @IsOptional() @Transform(emptyToNull) @IsEnum(LeadTemperature)
  temperature?: LeadTemperature | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(500)
  reason?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(120)
  bodyRegion?: string | null;

  @IsOptional() @IsBoolean()
  hasDiagnosis?: boolean | null;

  @IsOptional() @IsBoolean()
  previousPhysio?: boolean | null;

  @IsOptional() @Transform(emptyToNull) @IsUUID()
  responsibleId?: string | null;

  @IsOptional() @IsObject()
  intakeAnswers?: Record<string, unknown>;
}

export class UpdateLeadDto extends PartialType(LeadDto) {}

export class ConvertLeadDto {
  @IsOptional() @Transform(emptyToNull) @IsCpf()
  cpf?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsDateString()
  birthDate?: string | null;

  @IsOptional() @IsEnum(Sex)
  sex?: Sex;

  @IsOptional() @Transform(emptyToNull) @IsUUID()
  responsibleId?: string | null;

  @IsBoolean({ message: 'Registre o consentimento do paciente' })
  healthDataConsent: boolean;
}

export class LostLeadDto {
  @Transform(trim) @IsString() @MinLength(2, { message: 'Informe o motivo' }) @MaxLength(300)
  reason: string;
}

export class SearchQuery {
  @Transform(emptyToUndefined) @IsString() @MinLength(2) @MaxLength(100)
  q: string;
}

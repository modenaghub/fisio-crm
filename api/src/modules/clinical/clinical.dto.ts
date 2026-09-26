import { PartialType } from '@nestjs/mapped-types';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ConditionType, EvaluationType, TreatmentPlanStatus } from '@prisma/client';
import { emptyToNull, trim } from '../../common/helpers';

const Text = (max = 5000) => (target: object, key: string) => {
  IsOptional()(target, key);
  Transform(emptyToNull)(target, key);
  IsString()(target, key);
  MaxLength(max)(target, key);
};

export class ClinicalProfileDto {
  @Text(2000) mainComplaint?: string | null;
  @Text(2000) diagnosis?: string | null;
  @Text() medicalHistory?: string | null;
  @Text(2000) medications?: string | null;
  @Text(1000) allergies?: string | null;
  @Text(2000) contraindications?: string | null;
  @Text() observations?: string | null;
}

export class ConditionDto {
  @IsEnum(ConditionType)
  type: ConditionType;

  @Transform(trim) @IsString() @MinLength(2, { message: 'Descreva a condição' }) @MaxLength(200)
  description: string;

  @IsOptional() @Transform(emptyToNull) @IsString() @MaxLength(8)
  icd10Code?: string | null;

  @Text(100) bodyRegion?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsIn(['direito', 'esquerdo', 'bilateral', null])
  laterality?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsDateString()
  since?: string | null;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @Text(1000) notes?: string | null;
}

export class UpdateConditionDto extends PartialType(ConditionDto) {}

// ── Avaliação ──

export class RomRow {
  @Transform(trim) @IsString() @MaxLength(60) joint: string;
  @Transform(trim) @IsString() @MaxLength(60) movement: string;
  @IsOptional() @IsIn(['D', 'E', 'B', '']) side?: string;
  @IsOptional() @IsNumber() @Min(-90) @Max(360) degrees?: number | null;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class StrengthRow {
  @Transform(trim) @IsString() @MaxLength(80) muscle: string;
  @IsOptional() @IsIn(['D', 'E', 'B', '']) side?: string;
  @IsInt() @Min(0) @Max(5) grade: number;
  @IsOptional() @IsString() @MaxLength(200) notes?: string;
}

export class TestRow {
  @Transform(trim) @IsString() @MaxLength(100) name: string;
  @IsOptional() @IsIn(['positivo', 'negativo', 'inconclusivo', '']) result?: string;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

export class ScaleRow {
  @Transform(trim) @IsString() @MaxLength(100) name: string;
  @Transform(trim) @IsString() @MaxLength(40) score: string;
  @IsOptional() @IsString() @MaxLength(300) interpretation?: string;
}

export class EvaluationDto {
  @IsEnum(EvaluationType)
  type: EvaluationType;

  @IsDateString({}, { message: 'Data inválida' })
  performedAt: string;

  @IsOptional() @IsUUID()
  appointmentId?: string;

  @IsOptional() @IsInt() @Min(0) @Max(10)
  painScale?: number | null;

  @Text(2000) mainComplaint?: string | null;
  @Text() mobility?: string | null;
  @Text() posture?: string | null;
  @Text() functionalAssessment?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => RomRow)
  rangeOfMotion?: RomRow[];

  @IsOptional() @IsArray() @ArrayMaxSize(60) @ValidateNested({ each: true }) @Type(() => StrengthRow)
  strength?: StrengthRow[];

  @IsOptional() @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => TestRow)
  tests?: TestRow[];

  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => ScaleRow)
  scales?: ScaleRow[];

  @Text() otherParams?: string | null;
  @Text() conclusion?: string | null;
}

export class UpdateEvaluationDto extends PartialType(EvaluationDto) {}

// ── Plano de tratamento ──

export class TreatmentPlanDto {
  @Transform(trim) @IsString() @MinLength(3, { message: 'Descreva o objetivo' }) @MaxLength(2000)
  objective: string;

  @Transform(trim) @IsString() @MinLength(3, { message: 'Descreva o tratamento proposto' }) @MaxLength(5000)
  treatment: string;

  @IsOptional() @IsInt() @Min(1) @Max(14)
  frequencyPerWeek?: number | null;

  @IsOptional() @IsInt() @Min(1) @Max(500)
  plannedSessions?: number | null;

  @IsOptional() @Transform(emptyToNull) @IsDateString()
  startDate?: string | null;

  @IsOptional() @Transform(emptyToNull) @IsDateString()
  expectedEndDate?: string | null;

  @IsOptional() @IsUUID()
  evaluationId?: string | null;

  @IsOptional() @IsEnum(TreatmentPlanStatus)
  status?: TreatmentPlanStatus;

  @Text() observations?: string | null;
}

export class UpdateTreatmentPlanDto extends PartialType(TreatmentPlanDto) {}

// ── Sessão / evolução ──

export class EvolutionContentDto {
  @Text(2000) complaint?: string | null;
  @Text(2000) patientState?: string | null;

  @IsOptional() @IsInt() @Min(0) @Max(10)
  painScale?: number | null;

  @Text() procedures?: string | null;
  @Text() exercises?: string | null;
  @Text() techniques?: string | null;
  @Text(3000) treatmentResponse?: string | null;

  /** "Evolução / Observações do atendimento" — campo livre, obrigatório. */
  @Transform(trim) @IsString() @MinLength(10, { message: 'Descreva a evolução (mínimo de 10 caracteres)' }) @MaxLength(20000)
  evolutionText: string;

  @Text(3000) guidance?: string | null;
  @Text(3000) nextSteps?: string | null;
}

export class RegisterSessionDto extends EvolutionContentDto {
  @IsOptional() @IsUUID()
  appointmentId?: string;

  @IsOptional() @IsDateString()
  performedAt?: string;

  @IsOptional() @IsInt() @Min(5) @Max(480)
  durationMinutes?: number;

  @IsOptional() @IsUUID()
  treatmentPlanId?: string;

  /** Não descontar de pacote nem gerar cobrança (ex.: sessão cortesia). */
  @IsOptional() @IsBoolean()
  skipBilling?: boolean;
}

export class EditEvolutionDto extends EvolutionContentDto {
  @Transform(trim) @IsString() @MinLength(5, { message: 'Informe o motivo da alteração' }) @MaxLength(500)
  editReason: string;
}

export class DeleteReasonDto {
  @Transform(trim) @IsString() @MinLength(5, { message: 'Informe o motivo' }) @MaxLength(500)
  reason: string;
}

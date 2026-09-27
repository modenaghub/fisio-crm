import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';
import { emptyToNull, emptyToUndefined, trim } from '../../common/helpers';

export class SendMessageDto {
  @ValidateIf((o) => !o.templateKey)
  @Transform(trim) @IsString() @MinLength(1, { message: 'Escreva a mensagem' }) @MaxLength(4096)
  body?: string;

  @IsOptional() @IsString() @MaxLength(60)
  templateKey?: string;
}

export class ListConversationsQuery {
  @IsOptional() @IsIn(['BOT', 'OPEN', 'ASSIGNED', 'CLOSED', 'mine', 'unread', 'active'])
  status?: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;
}

export class AssignDto {
  @IsOptional() @Transform(emptyToNull) @IsUUID()
  userId: string | null;
}

export class ConversationStatusDto {
  @IsIn(['OPEN', 'CLOSED'])
  status: 'OPEN' | 'CLOSED';
}

export class LinkConversationDto {
  @IsOptional() @IsUUID() patientId?: string;
  @IsOptional() @IsUUID() leadId?: string;
}

export class UpdateTemplateDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(1024)
  body?: string;

  @IsOptional() @IsBoolean()
  isActive?: boolean;

  @IsOptional() @Transform(emptyToNull) @Matches(/^[a-z0-9_]{1,512}$/, { message: 'Use o nome do template aprovado na Meta (minúsculas, números e _)' })
  whatsappTemplateName?: string | null;

  @IsOptional() @IsArray() @ArrayMaxSize(3) @IsString({ each: true }) @MaxLength(20, { each: true })
  buttons?: string[];
}

export class SimulateInboundDto {
  @Matches(/^\+?[\d\s()-]{10,20}$/, { message: 'Telefone inválido' })
  from: string;

  @Transform(trim) @IsString() @MinLength(1) @MaxLength(1000)
  text: string;

  @IsOptional() @Transform(emptyToUndefined) @IsString() @MaxLength(80)
  name?: string;
}

export class RunRemindersDto {
  @IsOptional() @IsBoolean()
  includeRecent?: boolean;
}

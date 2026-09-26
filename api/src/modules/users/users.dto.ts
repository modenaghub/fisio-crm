import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from '../../common/validators';
import { PERMISSION_CATALOG } from '../../common/permissions';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class CreateUserDto {
  @Transform(trim) @IsString() @MinLength(3, { message: 'Informe o nome completo' }) @MaxLength(120)
  name: string;

  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(20)
  phone?: string;

  @IsUUID('all', { message: 'Selecione o perfil de acesso' })
  roleId: string;

  /** Se omitida, o usuário recebe um convite por e-mail para definir a própria senha. */
  @IsOptional() @IsString() @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password?: string;

  @IsOptional() @IsBoolean()
  isProfessional?: boolean;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  crefito?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  specialties?: string[];

  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  unitIds?: string[];
}

export class UpdateUserDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(120)
  name?: string;

  @IsOptional() @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' })
  email?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(20)
  phone?: string;

  @IsOptional() @IsUUID()
  roleId?: string;

  @IsOptional() @IsBoolean()
  isProfessional?: boolean;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(30)
  crefito?: string;

  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true })
  specialties?: string[];

  @IsOptional() @IsString() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'Cor inválida' })
  calendarColor?: string;

  @IsOptional() @IsArray() @IsUUID('all', { each: true })
  unitIds?: string[];
}

export class SetActiveDto {
  @IsBoolean()
  isActive: boolean;
}

const CODES = PERMISSION_CATALOG.map((p) => p.code);

export class PermissionOverrideDto {
  @IsIn(CODES, { message: 'Permissão desconhecida' })
  permissionCode: string;

  @IsBoolean()
  granted: boolean;
}

export class SetOverridesDto {
  @IsArray() @ValidateNested({ each: true }) @Type(() => PermissionOverrideDto)
  overrides: PermissionOverrideDto[];
}

export class ListUsersQuery {
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @IsOptional() @IsIn(['active', 'inactive', 'all'])
  status?: 'active' | 'inactive' | 'all';
}

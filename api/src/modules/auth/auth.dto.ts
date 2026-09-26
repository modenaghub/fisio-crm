import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MESSAGE, PASSWORD_REGEX } from '../../common/validators';

const lower = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class RegisterDto {
  @Transform(trim) @IsString() @MinLength(2, { message: 'Informe o nome da clínica' }) @MaxLength(120)
  organizationName: string;

  @Transform(trim) @IsString() @MinLength(3, { message: 'Informe seu nome completo' }) @MaxLength(120)
  name: string;

  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @IsString() @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password: string;

  @IsNotEmpty({ message: 'É necessário aceitar os termos de uso e a política de privacidade' })
  acceptTerms: true;
}

export class LoginDto {
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' })
  email: string;

  @IsString() @IsNotEmpty({ message: 'Informe a senha' }) @MaxLength(128)
  password: string;

  /** Quando o mesmo e-mail existe em mais de uma clínica. */
  @IsOptional() @IsUUID()
  organizationId?: string;
}

export class ForgotPasswordDto {
  @Transform(lower) @IsEmail({}, { message: 'E-mail inválido' })
  email: string;
}

export class ResetPasswordDto {
  @IsString() @IsNotEmpty()
  token: string;

  @IsString() @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  password: string;
}

export class ChangePasswordDto {
  @IsString() @IsNotEmpty({ message: 'Informe a senha atual' })
  currentPassword: string;

  @IsString() @Matches(PASSWORD_REGEX, { message: PASSWORD_MESSAGE })
  newPassword: string;
}

export class UpdateProfileDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(3) @MaxLength(120)
  name?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(20)
  phone?: string;
}

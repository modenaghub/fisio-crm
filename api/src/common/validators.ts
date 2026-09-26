import { registerDecorator, ValidationOptions } from 'class-validator';

/** Valida CPF pelos dígitos verificadores. */
export function isValidCpf(value: string): boolean {
  const cpf = (value ?? '').replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(cpf[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(cpf[9]) && calc(10) === Number(cpf[10]);
}

export function IsCpf(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isCpf',
      target: object.constructor,
      propertyName,
      options: { message: 'CPF inválido', ...options },
      validator: { validate: (v: unknown) => typeof v === 'string' && isValidCpf(v) },
    });
}

/** Senha: mínimo 8 caracteres, com letra e número. */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
export const PASSWORD_MESSAGE = 'A senha deve ter ao menos 8 caracteres, com letras e números';

export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

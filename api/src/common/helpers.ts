import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestContext } from './auth/auth.types';
import { PERMISSION_CATALOG } from './permissions';

/** Remove máscara de telefone/CPF. */
export const digits = (v?: string | null) => (v ?? '').replace(/\D/g, '');

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
export const emptyToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? undefined : value.trim()) : value;
export const emptyToNull = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? (value.trim() === '' ? null : value.trim()) : value;

export const can = (ctx: RequestContext, perm: string) => ctx.user.permissions.includes(perm);

/**
 * Pacientes que o usuário pode ver.
 * Com `patients.read_all` (administração/recepção): todos da clínica.
 * Sem ela (fisioterapeuta): os que estão sob sua responsabilidade ou que ele já atendeu/tem agendados.
 */
export function patientScope(ctx: RequestContext): Prisma.PatientWhereInput {
  const base: Prisma.PatientWhereInput = { organizationId: ctx.user.organizationId, deletedAt: null };
  if (can(ctx, 'patients.read_all')) return base;
  return {
    ...base,
    OR: [
      { responsibleId: ctx.user.id },
      { appointments: { some: { professionalId: ctx.user.id } } },
      { treatmentSessions: { some: { professionalId: ctx.user.id } } },
    ],
  };
}

export function notFound(entity = 'Registro'): never {
  throw new NotFoundException(`${entity} não encontrado`);
}

/** Converte "YYYY-MM-DD" em Date (UTC, meia-noite) para colunas @db.Date. */
export const toDate = (v?: string | null) => (v ? new Date(`${v.slice(0, 10)}T00:00:00.000Z`) : v === null ? null : undefined);

/** Data "YYYY-MM-DD" a partir de Date de coluna @db.Date. */
export const dateOnly = (d?: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function ageFrom(birth?: Date | null) {
  if (!birth) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const m = now.getUTCMonth() - birth.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < birth.getUTCDate())) age--;
  return age;
}

export const patientCode = (n: number) => `P-${String(n).padStart(4, '0')}`;

export function maskCpf(cpf: string | null) {
  if (!cpf || cpf.length !== 11) return null;
  return `***.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-**`;
}

export function formatCpf(cpf: string | null) {
  if (!cpf || cpf.length !== 11) return null;
  return `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}`;
}

export function paginate(page?: number, pageSize?: number, max = 100) {
  const p = Math.max(1, page ?? 1);
  const s = Math.min(max, Math.max(1, pageSize ?? 25));
  return { skip: (p - 1) * s, take: s, page: p, pageSize: s };
}

/** Início/fim do dia no fuso da clínica (padrão America/Sao_Paulo, UTC-3 sem horário de verão). */
export const TZ_OFFSET_MIN = -180;
export function startOfLocalDay(d = new Date()) {
  const local = new Date(d.getTime() + TZ_OFFSET_MIN * 60_000);
  local.setUTCHours(0, 0, 0, 0);
  return new Date(local.getTime() - TZ_OFFSET_MIN * 60_000);
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
export function localDateKey(d: Date) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
}
/** "YYYY-MM-DD" + "HH:MM" no fuso da clínica → instante UTC. */
export function localToUtc(date: string, time: string) {
  return new Date(new Date(`${date}T${time}:00.000Z`).getTime() - TZ_OFFSET_MIN * 60_000);
}
export function localWeekday(d: Date) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).getUTCDay();
}
export function localTime(d: Date) {
  return new Date(d.getTime() + TZ_OFFSET_MIN * 60_000).toISOString().slice(11, 16);
}

/**
 * Contexto de ações feitas pelo sistema (robô do WhatsApp, lembretes, automações), sem usuário humano.
 * O id vazio vira `null` nas colunas de autoria; o nome aparece na auditoria.
 */
export function systemContext(organizationId: string, name = 'Sistema'): RequestContext {
  return {
    user: { id: '', sessionId: '', organizationId, name, email: '', roleKey: 'SYSTEM', roleName: 'Sistema', permissions: PERMISSION_CATALOG.map((p) => p.code) },
  };
}

/** Id do autor para colunas de FK (vazio no contexto de sistema). */
export const actorId = (ctx: RequestContext) => ctx.user.id || null;

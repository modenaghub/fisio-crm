/**
 * BACKEND SIMULADO — usado somente na prévia publicada (VITE_DEMO=1).
 * Reproduz as rotas e as regras principais da API real (permissões, auditoria, sessões, convites)
 * em memória no navegador. Nada é salvo: recarregar a página volta ao estado inicial.
 */
import { effectivePermissions, PERMISSION_CATALOG, SYSTEM_ROLES } from '../../../api/src/common/permissions';

type Json = any;
const uid = () => crypto.randomUUID();
const now = () => new Date().toISOString();

interface Role { id: string; orgId: string; key: string; name: string; description: string | null; isSystem: boolean; permissions: string[] }
interface User {
  id: string; orgId: string; name: string; email: string; phone: string | null; roleId: string; password: string;
  isActive: boolean; failed: number; lockedUntil: number | null; lastLoginAt: string | null; createdAt: string; passwordSet: boolean;
  professional: { crefito: string | null; specialties: string[]; calendarColor: string } | null;
  unitIds: string[]; overrides: { permissionCode: string; granted: boolean }[];
}
interface Org {
  id: string; name: string; settings: Json; days: { weekday: number; intervals: { start: string; end: string }[] }[];
  services: Json[]; units: Json[]; categories: string[]; whatsappStatus: string;
}
interface Session { id: string; userId: string; ua: string; createdAt: string; lastUsedAt: string; revoked: boolean }

const db = {
  orgs: [] as Org[],
  roles: [] as Role[],
  users: [] as User[],
  sessions: [] as Session[],
  audit: [] as Json[],
  outbox: [] as Json[],
  resetTokens: new Map<string, { userId: string; used: boolean }>(),
  refreshSession: null as string | null, // faz o papel do cookie httpOnly
};

class HttpError { constructor(public status: number, public body: Json) {} }
const fail = (status: number, message: string | Json): never => {
  throw new HttpError(status, typeof message === 'string' ? { statusCode: status, message } : message);
};

// ───────────────────────── criação de organização ─────────────────────────

function createOrg(name: string, admin: { name: string; email: string; password: string }) {
  const org: Org = {
    id: uid(),
    name,
    settings: {
      clinicName: name, logoUrl: null, phone: null, whatsapp: null, email: null, addressLine: null, city: null, state: null, zipCode: null,
      defaultSessionPriceCents: 0, defaultSessionMinutes: 50, minBookingNoticeHours: 2, cancellationNoticeHours: 24, allowOverbooking: false,
      noShowFollowUpDays: 7, acceptedPaymentMethods: ['PIX', 'CASH', 'CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER'],
      onboardingCompletedAt: null, onboardingStep: 0,
    },
    days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, intervals: [] })),
    services: [],
    units: [{ id: uid(), name: 'Unidade principal', phone: null, addressLine: null, city: null, state: null, isActive: true }],
    categories: ['Aluguel', 'Equipamentos', 'Funcionários', 'Impostos', 'Marketing', 'Materiais', 'Outros', 'Software'],
    whatsappStatus: 'NOT_CONFIGURED',
  };
  db.orgs.push(org);
  const roleIds: Record<string, string> = {};
  for (const r of SYSTEM_ROLES) {
    const role: Role = { id: uid(), orgId: org.id, key: r.key, name: r.name, description: r.description, isSystem: true, permissions: [...r.permissions] };
    db.roles.push(role);
    roleIds[r.key] = role.id;
  }
  const user = addUser(org, { ...admin, roleId: roleIds.ADMIN, professional: { crefito: null, specialties: [], calendarColor: '#0f766e' } });
  return { org, user, roleIds };
}

function addUser(org: Org, u: { name: string; email: string; password: string; roleId: string; professional?: User['professional']; phone?: string }) {
  const user: User = {
    id: uid(), orgId: org.id, name: u.name, email: u.email.toLowerCase(), phone: u.phone ?? null, roleId: u.roleId, password: u.password,
    isActive: true, failed: 0, lockedUntil: null, lastLoginAt: null, createdAt: now(), passwordSet: true,
    professional: u.professional ?? null, unitIds: [org.units[0].id], overrides: [],
  };
  db.users.push(user);
  return user;
}

function audit(orgId: string, actor: User | null, action: string, entity: string, summary: string, extra: Json = {}) {
  db.audit.unshift({
    id: uid(), organizationId: orgId, actorUserId: actor?.id ?? null, actorName: actor?.name ?? null, action, entity,
    entityId: extra.entityId ?? null, summary, changes: extra.changes ?? null, metadata: extra.metadata ?? null,
    ipAddress: '127.0.0.1 (prévia)', userAgent: navigator.userAgent, createdAt: now(),
  });
}

// Clínica de demonstração já configurada
(function seed() {
  const { org, user: admin, roleIds } = createOrg('Clínica Demonstração', { name: 'Administrador Demo', email: 'admin@demo.fisiocrm.local', password: 'Demo@2026' });
  Object.assign(org.settings, { phone: '(00) 0000-0000', defaultSessionPriceCents: 12000, onboardingCompletedAt: now(), onboardingStep: 9, city: 'Cidade Exemplo', state: 'SP' });
  org.days = org.days.map((d) => ({ ...d, intervals: d.weekday >= 1 && d.weekday <= 5 ? [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] : [] }));
  org.services = [
    { id: uid(), name: 'Avaliação inicial', kind: 'EVALUATION', durationMinutes: 60, priceCents: 15000 },
    { id: uid(), name: 'Sessão de fisioterapia', kind: 'SESSION', durationMinutes: 50, priceCents: 12000 },
    { id: uid(), name: 'Pilates clínico', kind: 'SESSION', durationMinutes: 50, priceCents: 9000 },
  ];
  const fisio = addUser(org, { name: 'Fisioterapeuta Demo', email: 'fisio@demo.fisiocrm.local', password: 'Demo@2026', roleId: roleIds.PHYSIO, professional: { crefito: 'DEMO-0000', specialties: ['Ortopedia'], calendarColor: '#2563eb' } });
  const rec = addUser(org, { name: 'Recepção Demo', email: 'recepcao@demo.fisiocrm.local', password: 'Demo@2026', roleId: roleIds.RECEPTION });
  fisio.lastLoginAt = new Date(Date.now() - 3 * 3600e3).toISOString();
  rec.lastLoginAt = new Date(Date.now() - 26 * 3600e3).toISOString();
  audit(org.id, admin, 'CREATE', 'organization', 'Conta da clínica "Clínica Demonstração" criada');
  audit(org.id, admin, 'UPDATE', 'onboarding', 'Configuração inicial concluída');
  audit(org.id, admin, 'CREATE', 'user', 'Usuário Fisioterapeuta Demo criado com perfil Fisioterapeuta', { entityId: fisio.id });
  audit(org.id, admin, 'CREATE', 'user', 'Usuário Recepção Demo criado com perfil Recepção', { entityId: rec.id });
  audit(org.id, rec, 'LOGIN_FAILED', 'user', 'Senha incorreta', { entityId: rec.id });
  audit(org.id, rec, 'LOGIN', 'user', 'Login realizado', { entityId: rec.id });
  audit(org.id, fisio, 'LOGIN', 'user', 'Login realizado', { entityId: fisio.id });
})();

// ───────────────────────── helpers ─────────────────────────

const roleOf = (u: User) => db.roles.find((r) => r.id === u.roleId)!;
const permsOf = (u: User) => effectivePermissions(roleOf(u).permissions, u.overrides);
const orgOf = (u: User) => db.orgs.find((o) => o.id === u.orgId)!;

function presentUser(u: User) {
  const r = roleOf(u);
  const org = orgOf(u);
  return {
    id: u.id, name: u.name, email: u.email, phone: u.phone, avatarUrl: null, isActive: u.isActive,
    isLocked: !!u.lockedUntil && u.lockedUntil > Date.now(), lastLoginAt: u.lastLoginAt, createdAt: u.createdAt,
    role: { id: r.id, key: r.key, name: r.name }, professional: u.professional,
    units: org.units.filter((x) => u.unitIds.includes(x.id)).map((x) => ({ id: x.id, name: x.name })),
    overrides: u.overrides, permissions: permsOf(u),
  };
}

function me(u: User) {
  const org = orgOf(u);
  const r = roleOf(u);
  return {
    user: { id: u.id, name: u.name, email: u.email, phone: u.phone, avatarUrl: null, role: { id: r.id, key: r.key, name: r.name }, isProfessional: !!u.professional, units: org.units.map((x) => ({ id: x.id, name: x.name })), lastLoginAt: u.lastLoginAt },
    organization: { id: org.id, name: org.name, clinicName: org.settings.clinicName, logoUrl: org.settings.logoUrl, timezone: 'America/Sao_Paulo', onboardingCompleted: !!org.settings.onboardingCompletedAt, onboardingStep: org.settings.onboardingStep },
    permissions: permsOf(u),
  };
}

function issue(u: User) {
  const s: Session = { id: uid(), userId: u.id, ua: navigator.userAgent, createdAt: now(), lastUsedAt: now(), revoked: false };
  db.sessions.push(s);
  db.refreshSession = s.id;
  return { accessToken: s.id, expiresIn: 900 };
}

function sendLink(u: User, kind: 'invite' | 'reset') {
  const token = uid();
  db.resetTokens.set(token, { userId: u.id, used: false });
  const link = `https://prévia/redefinir-senha?token=${token}${kind === 'invite' ? '&convite=1' : ''}`;
  const org = orgOf(u);
  db.outbox.unshift({
    id: uid(), to: u.email, sentAt: now(),
    subject: kind === 'invite' ? `Convite para acessar o sistema da ${org.name}` : 'Redefinição de senha',
    text: kind === 'invite'
      ? `Olá, ${u.name.split(' ')[0]}!\n\nVocê foi convidado(a) para acessar o sistema da ${org.name}.\nDefina sua senha pelo link abaixo (válido por 72 horas):\n\n${link}\n`
      : `Olá, ${u.name.split(' ')[0]}!\n\nUse o link abaixo para criar uma nova senha (válido por 60 minutos):\n\n${link}\n`,
  });
}

const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;
const PASSWORD_MSG = 'A senha deve ter ao menos 8 caracteres, com letras e números';

// ───────────────────────── roteador ─────────────────────────

function handle(method: string, path: string, query: URLSearchParams, body: Json, token: string | null): Json {
  const m = (verb: string, re: RegExp) => (method === verb ? path.match(re) : null);

  // ── rotas públicas
  if (m('GET', /^\/system\/info$/)) return { environment: 'demo', integrations: { email: 'mock', whatsapp: 'mock' }, devMailbox: true };
  if (m('GET', /^\/dev\/mailbox$/)) return db.outbox;
  if (m('GET', /^\/health$/)) return { status: 'ok' };

  if (m('POST', /^\/auth\/register$/)) {
    const email = String(body.email ?? '').trim().toLowerCase();
    if (!PASSWORD_RE.test(body.password ?? '')) fail(400, { message: [PASSWORD_MSG] });
    const { org, user } = createOrg(body.organizationName.trim(), { name: body.name.trim(), email, password: body.password });
    user.lastLoginAt = now();
    audit(org.id, user, 'CREATE', 'organization', `Conta da clínica "${org.name}" criada`);
    return issue(user);
  }

  if (m('POST', /^\/auth\/login$/)) {
    const email = String(body.email ?? '').trim().toLowerCase();
    const candidates = db.users.filter((u) => u.email === email && u.isActive && (!body.organizationId || u.orgId === body.organizationId));
    if (!candidates.length) fail(401, 'E-mail ou senha incorretos');
    const ok: User[] = [];
    let locked = false;
    for (const u of candidates) {
      if (u.lockedUntil && u.lockedUntil > Date.now()) { locked = true; continue; }
      if (u.password === body.password) { ok.push(u); continue; }
      u.failed++;
      const lock = u.failed >= 5;
      if (lock) { u.failed = 0; u.lockedUntil = Date.now() + 15 * 60e3; locked = true; }
      audit(u.orgId, u, 'LOGIN_FAILED', 'user', lock ? 'Conta bloqueada por 15 min após tentativas inválidas' : 'Senha incorreta', { entityId: u.id });
    }
    if (!ok.length) locked ? fail(423, 'Acesso bloqueado temporariamente por excesso de tentativas. Tente novamente em 15 minutos ou redefina sua senha.') : fail(401, 'E-mail ou senha incorretos');
    if (ok.length > 1) return { requiresOrganization: true, organizations: ok.map((u) => ({ id: u.orgId, name: orgOf(u).name })) };
    const u = ok[0];
    u.failed = 0; u.lockedUntil = null; u.lastLoginAt = now();
    audit(u.orgId, u, 'LOGIN', 'user', 'Login realizado', { entityId: u.id });
    return issue(u);
  }

  if (m('POST', /^\/auth\/refresh$/)) {
    const s = db.sessions.find((x) => x.id === db.refreshSession && !x.revoked);
    const u = s && db.users.find((x) => x.id === s.userId && x.isActive);
    if (!s || !u) fail(401, 'Sessão encerrada');
    s!.lastUsedAt = now();
    return { accessToken: s!.id, expiresIn: 900 };
  }

  if (m('POST', /^\/auth\/logout$/)) {
    const s = db.sessions.find((x) => x.id === db.refreshSession);
    if (s) {
      s.revoked = true;
      const u = db.users.find((x) => x.id === s.userId)!;
      audit(u.orgId, u, 'LOGOUT', 'session', 'Logout');
    }
    db.refreshSession = null;
    return undefined;
  }

  if (m('POST', /^\/auth\/forgot-password$/)) {
    const email = String(body.email ?? '').trim().toLowerCase();
    db.users.filter((u) => u.email === email && u.isActive).forEach((u) => sendLink(u, 'reset'));
    return { message: 'Se o e-mail estiver cadastrado, você receberá um link para redefinir a senha.' };
  }

  if (m('POST', /^\/auth\/reset-password$/)) {
    const t = db.resetTokens.get(body.token);
    if (!t || t.used) fail(400, 'Link inválido ou expirado. Solicite um novo.');
    if (!PASSWORD_RE.test(body.password ?? '')) fail(400, { message: [PASSWORD_MSG] });
    t!.used = true;
    const u = db.users.find((x) => x.id === t!.userId)!;
    u.password = body.password; u.passwordSet = true; u.lockedUntil = null; u.failed = 0;
    db.sessions.filter((s) => s.userId === u.id).forEach((s) => (s.revoked = true));
    audit(u.orgId, u, 'PASSWORD_RESET', 'user', 'Senha redefinida por link; todas as sessões foram encerradas', { entityId: u.id });
    return { message: 'Senha redefinida. Entre com a nova senha.' };
  }

  // ── daqui em diante: autenticado
  const session = db.sessions.find((s) => s.id === token && !s.revoked);
  const actor = session && db.users.find((u) => u.id === session.userId && u.isActive);
  if (!session || !actor) fail(401, 'Sessão encerrada');
  const u = actor!;
  const org = orgOf(u);
  const need = (...p: string[]) => {
    const missing = p.filter((x) => !permsOf(u).includes(x));
    if (missing.length) fail(403, { statusCode: 403, message: 'Você não tem permissão para esta ação', missing });
  };
  const log = (action: string, entity: string, summary: string, extra?: Json) => audit(org.id, u, action, entity, summary, extra);
  const orgUsers = () => db.users.filter((x) => x.orgId === org.id);
  const findUser = (id: string) => orgUsers().find((x) => x.id === id) ?? fail(404, 'Usuário não encontrado');
  const keepsAdmin = (id: string) => {
    if (!orgUsers().some((x) => x.id !== id && x.isActive && roleOf(x).key === 'ADMIN')) fail(400, 'A clínica precisa de ao menos um administrador ativo');
  };

  // me / conta
  if (m('GET', /^\/auth\/me$/)) return me(u);
  if (m('PATCH', /^\/auth\/me$/)) {
    Object.assign(u, { name: body.name ?? u.name, phone: body.phone || null });
    log('UPDATE', 'user', 'Perfil atualizado', { entityId: u.id });
    return me(u);
  }
  if (m('POST', /^\/auth\/change-password$/)) {
    if (body.currentPassword !== u.password) fail(400, 'Senha atual incorreta');
    if (!PASSWORD_RE.test(body.newPassword ?? '')) fail(400, { message: [PASSWORD_MSG] });
    u.password = body.newPassword;
    db.sessions.filter((s) => s.userId === u.id && s.id !== session!.id).forEach((s) => (s.revoked = true));
    log('PASSWORD_CHANGE', 'user', 'Senha alterada; outras sessões encerradas', { entityId: u.id });
    return undefined;
  }
  if (m('GET', /^\/auth\/sessions$/)) {
    return db.sessions
      .filter((s) => s.userId === u.id && !s.revoked)
      .map((s) => ({ id: s.id, userAgent: s.ua, ipAddress: '127.0.0.1', lastUsedAt: s.lastUsedAt, createdAt: s.createdAt, isCurrent: s.id === session!.id }));
  }
  let r;
  if ((r = m('DELETE', /^\/auth\/sessions\/(.+)$/))) {
    const s = db.sessions.find((x) => x.id === r![1] && x.userId === u.id);
    if (s) s.revoked = true;
    log('LOGOUT', 'session', 'Sessão encerrada pelo usuário');
    return undefined;
  }
  if (m('POST', /^\/auth\/sessions\/revoke-others$/)) {
    const others = db.sessions.filter((s) => s.userId === u.id && s.id !== session!.id && !s.revoked);
    others.forEach((s) => (s.revoked = true));
    log('LOGOUT', 'session', 'Encerrou as demais sessões');
    return { revoked: others.length };
  }

  // usuários
  if (m('GET', /^\/users\/professionals$/)) return orgUsers().filter((x) => x.isActive && x.professional).map((x) => ({ id: x.id, name: x.name, calendarColor: x.professional!.calendarColor }));
  if (m('GET', /^\/users$/)) {
    need('users.manage');
    const st = query.get('status') ?? 'active';
    return orgUsers()
      .filter((x) => st === 'all' || (st === 'active' ? x.isActive : !x.isActive))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(presentUser);
  }
  if ((r = m('GET', /^\/users\/([^/]+)$/))) { need('users.manage'); return presentUser(findUser(r[1])); }
  if (m('POST', /^\/users$/)) {
    need('users.manage');
    const email = String(body.email).trim().toLowerCase();
    if (orgUsers().some((x) => x.email === email)) fail(409, 'Já existe um usuário com este e-mail nesta clínica');
    const nu = addUser(org, {
      name: body.name.trim(), email, password: body.password ?? uid(), roleId: body.roleId, phone: body.phone,
      professional: body.isProfessional ? { crefito: body.crefito ?? null, specialties: body.specialties ?? [], calendarColor: '#0f766e' } : null,
    });
    nu.unitIds = body.unitIds?.length ? body.unitIds : nu.unitIds;
    nu.passwordSet = !!body.password;
    log('CREATE', 'user', `Usuário ${nu.name} criado com perfil ${roleOf(nu).name}`, { entityId: nu.id });
    if (!body.password) {
      sendLink(nu, 'invite');
      log('PASSWORD_RESET_REQUEST', 'user', 'Convite de acesso enviado', { entityId: nu.id });
    }
    return { ...presentUser(nu), invited: !body.password };
  }
  if ((r = m('PATCH', /^\/users\/([^/]+)$/))) {
    need('users.manage');
    const t = findUser(r[1]);
    const before = presentUser(t);
    if (body.roleId && body.roleId !== t.roleId) {
      if (t.id === u.id) fail(400, 'Você não pode alterar o seu próprio perfil de acesso');
      if (roleOf(t).key === 'ADMIN') keepsAdmin(t.id);
      t.roleId = body.roleId;
    }
    if (body.email && body.email.toLowerCase() !== t.email && orgUsers().some((x) => x.email === body.email.toLowerCase())) fail(409, 'Já existe um usuário com este e-mail nesta clínica');
    Object.assign(t, { name: body.name ?? t.name, email: (body.email ?? t.email).toLowerCase(), phone: body.phone ?? t.phone });
    if (body.unitIds) t.unitIds = body.unitIds;
    if (body.isProfessional === false) t.professional = null;
    else if (body.isProfessional || t.professional)
      t.professional = {
        crefito: body.crefito ?? t.professional?.crefito ?? null,
        specialties: body.specialties ?? t.professional?.specialties ?? [],
        calendarColor: body.calendarColor ?? t.professional?.calendarColor ?? '#0f766e',
      };
    const after = presentUser(t);
    const changes: Json = {};
    if (before.name !== after.name) changes.name = { from: before.name, to: after.name };
    if (before.email !== after.email) changes.email = { from: before.email, to: after.email };
    if (before.role.name !== after.role.name) changes.role = { from: before.role.name, to: after.role.name };
    if (before.professional?.crefito !== after.professional?.crefito) changes.crefito = { from: before.professional?.crefito ?? null, to: after.professional?.crefito ?? null };
    log(changes.role ? 'PERMISSION_CHANGE' : 'UPDATE', 'user', `Usuário ${t.name} atualizado`, { entityId: t.id, changes });
    return after;
  }
  if ((r = m('PUT', /^\/users\/([^/]+)\/active$/))) {
    need('users.manage');
    const t = findUser(r[1]);
    if (t.id === u.id && !body.isActive) fail(400, 'Você não pode desativar o seu próprio usuário');
    if (!body.isActive && roleOf(t).key === 'ADMIN') keepsAdmin(t.id);
    t.isActive = body.isActive;
    if (!t.isActive) db.sessions.filter((s) => s.userId === t.id).forEach((s) => (s.revoked = true));
    log('UPDATE', 'user', t.isActive ? `Usuário ${t.name} reativado` : `Usuário ${t.name} desativado e desconectado`, { entityId: t.id, changes: { isActive: { from: !t.isActive, to: t.isActive } } });
    return presentUser(t);
  }
  if ((r = m('POST', /^\/users\/([^/]+)\/unlock$/))) {
    need('users.manage');
    const t = findUser(r[1]);
    t.lockedUntil = null; t.failed = 0;
    log('UPDATE', 'user', `Acesso de ${t.name} desbloqueado`, { entityId: t.id });
    return presentUser(t);
  }
  if ((r = m('PUT', /^\/users\/([^/]+)\/permissions$/))) {
    need('users.manage', 'roles.manage');
    const t = findUser(r[1]);
    if (t.id === u.id) fail(400, 'Você não pode alterar as suas próprias permissões');
    const from = t.overrides;
    t.overrides = body.overrides;
    log('PERMISSION_CHANGE', 'user', `Exceções de permissão de ${t.name} atualizadas`, { entityId: t.id, changes: { overrides: { from, to: t.overrides } } });
    return presentUser(t);
  }
  if ((r = m('POST', /^\/users\/([^/]+)\/send-access-link$/))) {
    need('users.manage');
    const t = findUser(r[1]);
    const kind = t.passwordSet ? 'reset' : 'invite';
    sendLink(t, kind);
    log('PASSWORD_RESET_REQUEST', 'user', kind === 'invite' ? 'Convite de acesso enviado' : 'Link de redefinição de senha enviado', { entityId: t.id });
    return { sent: true, kind };
  }

  // perfis
  const orgRoles = () => db.roles.filter((x) => x.orgId === org.id);
  const presentRole = (x: Role) => ({
    id: x.id, key: x.key, name: x.name, description: x.description, isSystem: x.isSystem, isLocked: x.key === 'ADMIN',
    activeUsers: orgUsers().filter((y) => y.roleId === x.id && y.isActive).length, permissions: [...x.permissions].sort(),
  });
  if (m('GET', /^\/roles\/permissions$/)) {
    need('users.manage');
    const groups = new Map<string, Json[]>();
    PERMISSION_CATALOG.forEach((p) => groups.set(p.module, [...(groups.get(p.module) ?? []), { code: p.code, description: p.description }]));
    return [...groups].map(([module, permissions]) => ({ module, permissions }));
  }
  if (m('GET', /^\/roles$/)) { need('users.manage'); return orgRoles().sort((a, b) => Number(b.isSystem) - Number(a.isSystem)).map(presentRole); }
  if (m('POST', /^\/roles$/)) {
    need('roles.manage');
    const role: Role = { id: uid(), orgId: org.id, key: `CUSTOM_${Date.now()}`, name: body.name, description: body.description ?? null, isSystem: false, permissions: body.permissions };
    db.roles.push(role);
    log('CREATE', 'role', `Perfil "${role.name}" criado`, { entityId: role.id });
    return presentRole(role);
  }
  if ((r = m('PATCH', /^\/roles\/([^/]+)$/))) {
    need('roles.manage');
    const role = orgRoles().find((x) => x.id === r![1]) ?? fail(404, 'Perfil não encontrado');
    if (role.key === 'ADMIN' && body.permissions) fail(400, 'As permissões do Administrador não podem ser alteradas');
    const added = (body.permissions ?? role.permissions).filter((p: string) => !role.permissions.includes(p));
    const removed = body.permissions ? role.permissions.filter((p) => !body.permissions.includes(p)) : [];
    Object.assign(role, { name: body.name ?? role.name, description: body.description ?? role.description, permissions: body.permissions ?? role.permissions });
    log('PERMISSION_CHANGE', 'role', `Perfil "${role.name}" atualizado`, { entityId: role.id, metadata: { adicionadas: added, removidas: removed } });
    return presentRole(role);
  }
  if ((r = m('DELETE', /^\/roles\/([^/]+)$/))) {
    need('roles.manage');
    const role = orgRoles().find((x) => x.id === r![1]) ?? fail(404, 'Perfil não encontrado');
    if (role.isSystem) fail(400, 'Perfis do sistema não podem ser excluídos');
    if (orgUsers().some((x) => x.roleId === role.id)) fail(400, 'Mova os usuários deste perfil antes de excluí-lo');
    db.roles = db.roles.filter((x) => x.id !== role.id);
    log('DELETE', 'role', `Perfil "${role.name}" excluído`, { entityId: role.id });
    return undefined;
  }

  // configurações
  if (m('GET', /^\/settings$/)) { need('settings.manage'); return org.settings; }
  if (m('PATCH', /^\/settings$/)) {
    need('settings.manage');
    const changes: Json = {};
    for (const [k, v] of Object.entries(body)) {
      const nv = v === '' ? null : v;
      if (JSON.stringify(org.settings[k]) !== JSON.stringify(nv)) changes[k] = { from: org.settings[k], to: nv };
      org.settings[k] = nv;
    }
    if (body.clinicName) org.name = body.clinicName;
    log('UPDATE', 'business_settings', 'Configurações da clínica atualizadas', { changes });
    return org.settings;
  }
  if (m('GET', /^\/settings\/hours$/)) return { unitId: org.units[0].id, days: org.days };
  if (m('PUT', /^\/settings\/hours$/)) {
    need('schedule.availability');
    saveHours(org, body.days);
    log('UPDATE', 'availability_rules', 'Horários de atendimento atualizados');
    return { unitId: org.units[0].id, days: org.days };
  }
  if (m('GET', /^\/settings\/services$/)) return org.services;
  if (m('PUT', /^\/settings\/services$/)) {
    need('settings.manage');
    saveServices(org, body.services);
    log('UPDATE', 'services', 'Serviços e valores atualizados');
    return org.services;
  }
  if (m('GET', /^\/settings\/units$/)) return org.units;
  if (m('POST', /^\/settings\/units$/)) {
    need('settings.manage');
    const unit = { id: uid(), name: body.name, phone: body.phone || null, addressLine: body.addressLine || null, city: body.city || null, state: body.state || null, isActive: true };
    org.units.push(unit);
    log('CREATE', 'unit', `Unidade "${unit.name}" criada`, { entityId: unit.id });
    return unit;
  }
  if ((r = m('PATCH', /^\/settings\/units\/([^/]+)$/))) {
    need('settings.manage');
    const unit = org.units.find((x) => x.id === r![1]) ?? fail(404, 'Unidade não encontrada');
    if (body.isActive === false && unit.isActive && org.units.filter((x) => x.isActive).length <= 1) fail(400, 'A clínica precisa de ao menos uma unidade ativa');
    Object.assign(unit, { name: body.name, phone: body.phone || null, addressLine: body.addressLine || null, city: body.city || null, state: body.state || null, isActive: body.isActive ?? unit.isActive });
    log('UPDATE', 'unit', `Unidade "${unit.name}" atualizada`, { entityId: unit.id });
    return unit;
  }

  // primeiro acesso
  if (m('GET', /^\/onboarding$/)) { need('settings.manage'); return onboarding(org, u); }
  if ((r = m('PUT', /^\/onboarding\/steps\/(\d)$/))) {
    need('settings.manage');
    const step = Number(r[1]);
    const s = org.settings;
    switch (step) {
      case 1: s.clinicName = body.clinicName; org.name = body.clinicName; break;
      case 2: u.name = body.name; u.professional = { crefito: body.crefito || null, specialties: body.specialties ?? [], calendarColor: u.professional?.calendarColor ?? '#0f766e' }; break;
      case 3: s.logoUrl = body.logoDataUrl; break;
      case 4: Object.assign(s, { phone: body.phone, email: body.email || null, addressLine: body.addressLine || null, city: body.city || null, state: body.state || null, zipCode: body.zipCode || null }); break;
      case 5: saveHours(org, body.days); break;
      case 6: {
        s.defaultSessionPriceCents = body.defaultSessionPriceCents; s.defaultSessionMinutes = body.defaultSessionMinutes;
        const basic = (kind: string, name: string, priceCents: number, durationMinutes: number) => {
          const f = org.services.find((x) => x.kind === kind);
          if (f) Object.assign(f, { priceCents, durationMinutes });
          else org.services.push({ id: uid(), name, kind, priceCents, durationMinutes });
        };
        basic('SESSION', 'Sessão de fisioterapia', body.defaultSessionPriceCents, body.defaultSessionMinutes);
        if (body.evaluationPriceCents != null) basic('EVALUATION', 'Avaliação inicial', body.evaluationPriceCents, Math.max(60, body.defaultSessionMinutes));
        break;
      }
      case 7: saveServices(org, body.services); break;
      case 8: s.whatsapp = body.whatsapp || null; org.whatsappStatus = body.whatsapp ? 'MOCK' : 'NOT_CONFIGURED'; break;
      case 9: s.acceptedPaymentMethods = body.acceptedPaymentMethods; org.categories = body.expenseCategories; break;
    }
    s.onboardingStep = Math.max(s.onboardingStep, step);
    log('UPDATE', 'onboarding', `Primeiro acesso: etapa ${step} salva`);
    return onboarding(org, u);
  }
  if (m('POST', /^\/onboarding\/complete$/)) {
    need('settings.manage');
    const missing = [];
    if (!org.days.some((d) => d.intervals.length)) missing.push('horários de atendimento');
    if (!org.services.length) missing.push('serviços e valores');
    if (missing.length) fail(400, `Para concluir, preencha: ${missing.join(', ')}`);
    org.settings.onboardingCompletedAt = now();
    org.settings.onboardingStep = 9;
    log('UPDATE', 'onboarding', 'Configuração inicial concluída');
    return { completed: true };
  }

  // auditoria
  if (m('GET', /^\/audit-logs\/entities$/)) { need('audit.view'); return [...new Set(db.audit.filter((a) => a.organizationId === org.id).map((a) => a.entity))].sort(); }
  if (m('GET', /^\/audit-logs$/)) {
    need('audit.view');
    const page = Number(query.get('page') ?? 1);
    const size = Number(query.get('pageSize') ?? 25);
    const s = (query.get('search') ?? '').toLowerCase();
    const from = query.get('from');
    const to = query.get('to');
    const items = db.audit.filter(
      (a) =>
        a.organizationId === org.id &&
        (!query.get('action') || a.action === query.get('action')) &&
        (!query.get('entity') || a.entity === query.get('entity')) &&
        (!s || (a.summary ?? '').toLowerCase().includes(s) || (a.actorName ?? '').toLowerCase().includes(s)) &&
        (!from || a.createdAt >= from) &&
        (!to || a.createdAt <= to),
    );
    return { total: items.length, page, pageSize: size, items: items.slice((page - 1) * size, page * size) };
  }

  fail(404, 'Rota não disponível na prévia');
}

function saveHours(org: Org, days: Org['days']) {
  const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  for (const d of days) {
    const sorted = [...d.intervals].sort((a, b) => toMin(a.start) - toMin(b.start));
    sorted.forEach((iv, i) => {
      if (toMin(iv.start) >= toMin(iv.end)) fail(400, `Horário inválido: ${iv.start}–${iv.end} (início deve ser antes do fim)`);
      if (i > 0 && toMin(iv.start) < toMin(sorted[i - 1].end)) fail(400, 'Horários sobrepostos');
    });
  }
  if (!days.some((d) => d.intervals.length)) fail(400, 'Informe ao menos um horário de atendimento');
  org.days = [0, 1, 2, 3, 4, 5, 6].map((weekday) => days.find((d) => d.weekday === weekday) ?? { weekday, intervals: [] });
}

function saveServices(org: Org, services: Json[]) {
  org.services = services.map((s) => ({ id: s.id ?? uid(), name: s.name, kind: s.kind, durationMinutes: s.durationMinutes, priceCents: s.priceCents }));
}

function onboarding(org: Org, u: User) {
  const s = org.settings;
  return {
    completed: !!s.onboardingCompletedAt,
    currentStep: s.onboardingStep,
    data: {
      1: { clinicName: s.clinicName },
      2: { name: u.name, crefito: u.professional?.crefito ?? '', specialties: u.professional?.specialties ?? [] },
      3: { logoDataUrl: s.logoUrl },
      4: { phone: s.phone ?? '', email: s.email ?? '', addressLine: s.addressLine ?? '', city: s.city ?? '', state: s.state ?? '', zipCode: s.zipCode ?? '' },
      5: { unitId: org.units[0].id, days: org.days },
      6: { defaultSessionPriceCents: s.defaultSessionPriceCents, defaultSessionMinutes: s.defaultSessionMinutes, evaluationPriceCents: org.services.find((x) => x.kind === 'EVALUATION')?.priceCents ?? null },
      7: { services: org.services },
      8: { whatsapp: s.whatsapp ?? '', integrationStatus: org.whatsappStatus },
      9: { acceptedPaymentMethods: s.acceptedPaymentMethods, expenseCategories: org.categories },
    },
  };
}

/** Substituto de fetch para a prévia. */
export async function demoFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'https://demo.local');
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const headers = new Headers(init?.headers);
  const token = headers.get('Authorization')?.replace('Bearer ', '') ?? null;
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180)); // latência de rede realista
  try {
    const data = handle(init?.method ?? 'GET', path, url.searchParams, body, token);
    if (data === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    if (e instanceof HttpError) return new Response(JSON.stringify(e.body), { status: e.status, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ message: 'Erro inesperado na prévia' }), { status: 500 });
  }
}

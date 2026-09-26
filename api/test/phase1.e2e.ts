/**
 * Testes ponta a ponta da Fase 1 contra a API rodando e um PostgreSQL real.
 *   API_URL=http://localhost:3000/api/v1 DATABASE_URL=... npm run test:e2e
 * A API deve estar em modo de e-mail "mock" (padrão em desenvolvimento) e com AUTH_ROTATION_GRACE_MS=0.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';

const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
const prisma = new PrismaClient();
const uniq = Date.now().toString(36);

type Res = { status: number; body: any; cookie?: string };

async function call(method: string, path: string, opts: { token?: string; body?: unknown; cookie?: string; ip?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  // IP distinto por cenário para não esbarrar no rate limit do login entre testes.
  headers['x-forwarded-for'] = opts.ip ?? '10.0.0.1';
  const r = await fetch(API + path, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  const setCookie = r.headers.get('set-cookie') ?? undefined;
  return { status: r.status, body: text ? JSON.parse(text) : null, cookie: setCookie?.split(';')[0] };
}

async function login(email: string, password: string, ip = '10.0.1.1') {
  const r = await call('POST', '/auth/login', { body: { email, password }, ip });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { token: r.body.accessToken as string, cookie: r.cookie! };
}

async function lastMailTo(email: string) {
  const r = await call('GET', '/dev/mailbox');
  const mail = r.body.find((m: any) => m.to === email);
  assert.ok(mail, `e-mail para ${email} não encontrado`);
  return decodeURIComponent(/token=([^&\s]+)/.exec(mail.text)![1]);
}

const adminEmail = `dono-${uniq}@teste.local`;
const physioEmail = `fisio-${uniq}@teste.local`;
const receptionEmail = `recepcao-${uniq}@teste.local`;
const PASS = 'Senha123forte';
const s: Record<string, any> = {};

test('cadastro cria clínica com administrador e onboarding pendente', async () => {
  const bad = await call('POST', '/auth/register', { body: { organizationName: 'X', name: 'A', email: 'x', password: '123', acceptTerms: true }, ip: '10.9.0.1' });
  assert.equal(bad.status, 400);

  const r = await call('POST', '/auth/register', {
    body: { organizationName: `Clínica Teste ${uniq}`, name: 'Dona da Clínica', email: adminEmail, password: PASS, acceptTerms: true },
    ip: '10.9.0.2',
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.ok(r.cookie?.startsWith('fisio_rt='), 'refresh token deve vir em cookie');
  assert.equal(r.body.refreshToken, undefined, 'refresh token não pode vir no corpo');
  s.admin = { token: r.body.accessToken, cookie: r.cookie };

  const me = await call('GET', '/auth/me', { token: s.admin.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.role.key, 'ADMIN');
  assert.equal(me.body.organization.onboardingCompleted, false);
  assert.ok(me.body.permissions.includes('clinical.delete'));
  s.orgId = me.body.organization.id;
});

test('onboarding valida cada etapa e conclui', async () => {
  const t = s.admin.token;
  const early = await call('POST', '/onboarding/complete', { token: t });
  assert.equal(early.status, 400, 'não conclui sem horários');

  const overlap = await call('PUT', '/onboarding/steps/5', {
    token: t,
    body: { days: [{ weekday: 1, intervals: [{ start: '08:00', end: '12:00' }, { start: '11:00', end: '13:00' }] }] },
  });
  assert.equal(overlap.status, 400);
  assert.match(JSON.stringify(overlap.body), /sobrepostos/);

  const steps: [number, unknown][] = [
    [1, { clinicName: `Clínica Teste ${uniq}` }],
    [2, { name: 'Dona da Clínica', crefito: '12345-F', specialties: ['Ortopedia'] }],
    [3, { logoDataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    [4, { phone: '(11) 3333-4444', city: 'São Paulo', state: 'SP', zipCode: '01000-000' }],
    [5, { days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, intervals: [{ start: '08:00', end: '12:00' }, { start: '14:00', end: '18:00' }] })) }],
    [6, { defaultSessionPriceCents: 12000, defaultSessionMinutes: 50, evaluationPriceCents: 15000 }],
  ];
  for (const [step, body] of steps) {
    const r = await call('PUT', `/onboarding/steps/${step}`, { token: t, body });
    assert.equal(r.status, 200, `etapa ${step}: ${JSON.stringify(r.body)}`);
  }
  const state = await call('GET', '/onboarding', { token: t });
  const services = state.body.data[7].services;
  assert.equal(services.length, 2, 'etapa 6 cria sessão e avaliação');

  const r7 = await call('PUT', '/onboarding/steps/7', {
    token: t,
    body: { services: [...services.map((x: any) => ({ id: x.id, name: x.name, kind: x.kind, durationMinutes: x.durationMinutes, priceCents: x.priceCents })), { name: 'Pilates clínico', kind: 'SESSION', durationMinutes: 50, priceCents: 9000 }] },
  });
  assert.equal(r7.status, 200);
  assert.equal((await call('PUT', '/onboarding/steps/8', { token: t, body: { whatsapp: '(11) 98888-7777' } })).status, 200);
  assert.equal((await call('PUT', '/onboarding/steps/9', { token: t, body: { acceptedPaymentMethods: ['PIX', 'CASH'], expenseCategories: ['Aluguel', 'Materiais'] } })).status, 200);
  const extra = await call('PUT', '/onboarding/steps/9', { token: t, body: { acceptedPaymentMethods: ['PIX'], expenseCategories: [], hacker: 1 } });
  assert.equal(extra.status, 400, 'campos desconhecidos são rejeitados');

  const done = await call('POST', '/onboarding/complete', { token: t });
  assert.equal(done.status, 200);
  const me = await call('GET', '/auth/me', { token: t });
  assert.equal(me.body.organization.onboardingCompleted, true);
});

test('administrador cria fisioterapeuta com senha e recepção por convite', async () => {
  const roles = await call('GET', '/roles', { token: s.admin.token });
  const byKey = Object.fromEntries(roles.body.map((r: any) => [r.key, r.id]));
  s.roles = byKey;

  const physio = await call('POST', '/users', {
    token: s.admin.token,
    body: { name: 'Fisio Teste', email: physioEmail, roleId: byKey.PHYSIO, password: PASS, isProfessional: true, crefito: '999-F' },
  });
  assert.equal(physio.status, 201, JSON.stringify(physio.body));
  s.physioId = physio.body.id;

  const dup = await call('POST', '/users', { token: s.admin.token, body: { name: 'Outro', email: physioEmail, roleId: byKey.PHYSIO, password: PASS } });
  assert.equal(dup.status, 409);

  const rec = await call('POST', '/users', { token: s.admin.token, body: { name: 'Recepção Teste', email: receptionEmail, roleId: byKey.RECEPTION } });
  assert.equal(rec.status, 201);
  assert.equal(rec.body.invited, true);
  s.receptionId = rec.body.id;

  const token = await lastMailTo(receptionEmail);
  const reset = await call('POST', '/auth/reset-password', { body: { token, password: PASS } });
  assert.equal(reset.status, 200);
  const reuse = await call('POST', '/auth/reset-password', { body: { token, password: PASS } });
  assert.equal(reuse.status, 400, 'link de convite é de uso único');

  s.reception = await login(receptionEmail, PASS, '10.0.2.1');
  s.physio = await login(physioEmail, PASS, '10.0.2.2');
});

test('permissões por perfil são aplicadas na API', async () => {
  assert.equal((await call('GET', '/users', { token: s.reception.token })).status, 403);
  assert.equal((await call('GET', '/audit-logs', { token: s.reception.token })).status, 403);
  assert.equal((await call('GET', '/audit-logs', { token: s.physio.token })).status, 403);
  assert.equal((await call('PATCH', '/settings', { token: s.physio.token, body: { clinicName: 'Hack' } })).status, 403);
  assert.equal((await call('GET', '/settings/services', { token: s.physio.token })).status, 200);

  const me = await call('GET', '/auth/me', { token: s.reception.token });
  assert.ok(!me.body.permissions.includes('clinical.read'), 'recepção não vê prontuário por padrão');
});

test('exceção individual concede acesso clínico à recepção e vale na hora', async () => {
  const r = await call('PUT', `/users/${s.receptionId}/permissions`, {
    token: s.admin.token,
    body: { overrides: [{ permissionCode: 'clinical.read', granted: true }, { permissionCode: 'finance.write', granted: false }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const me = await call('GET', '/auth/me', { token: s.reception.token });
  assert.ok(me.body.permissions.includes('clinical.read'));
  assert.ok(!me.body.permissions.includes('finance.write'));

  const self = await call('PUT', `/users/${(await call('GET', '/auth/me', { token: s.admin.token })).body.user.id}/permissions`, { token: s.admin.token, body: { overrides: [] } });
  assert.equal(self.status, 400, 'ninguém altera as próprias permissões');
});

test('papel Administrador é protegido e a clínica nunca fica sem admin', async () => {
  const r = await call('PATCH', `/roles/${s.roles.ADMIN}`, { token: s.admin.token, body: { permissions: ['dashboard.view'] } });
  assert.equal(r.status, 400);
  const meId = (await call('GET', '/auth/me', { token: s.admin.token })).body.user.id;
  assert.equal((await call('PUT', `/users/${meId}/active`, { token: s.admin.token, body: { isActive: false } })).status, 400);
  assert.equal((await call('PATCH', `/users/${meId}`, { token: s.admin.token, body: { roleId: s.roles.PHYSIO } })).status, 400);
});

test('isolamento entre clínicas', async () => {
  const demo = await login('admin@demo.fisiocrm.local', 'Demo@2026', '10.0.3.1');
  assert.equal((await call('GET', `/users/${s.physioId}`, { token: demo.token })).status, 404);
  assert.equal((await call('PATCH', `/users/${s.physioId}`, { token: demo.token, body: { name: 'Invasor' } })).status, 404);
  assert.equal((await call('PUT', `/users/${s.physioId}/active`, { token: demo.token, body: { isActive: false } })).status, 404);
  const list = await call('GET', '/users?status=all', { token: demo.token });
  assert.ok(!list.body.some((u: any) => u.email === physioEmail));
  const audit = await call('GET', '/audit-logs?pageSize=100', { token: demo.token });
  assert.ok(audit.body.items.every((a: any) => a.organizationId !== s.orgId));
});

test('desativar usuário derruba o acesso imediatamente', async () => {
  const before = await call('GET', '/auth/me', { token: s.physio.token });
  assert.equal(before.status, 200);
  assert.equal((await call('PUT', `/users/${s.physioId}/active`, { token: s.admin.token, body: { isActive: false } })).status, 200);
  assert.equal((await call('GET', '/auth/me', { token: s.physio.token })).status, 401, 'token ainda válido é recusado');
  const relogin = await call('POST', '/auth/login', { body: { email: physioEmail, password: PASS }, ip: '10.0.4.1' });
  assert.equal(relogin.status, 401);
  await call('PUT', `/users/${s.physioId}/active`, { token: s.admin.token, body: { isActive: true } });
});

test('rotação do refresh token e detecção de reuso', async () => {
  const sess = await login(physioEmail, PASS, '10.0.5.1');
  const r1 = await call('POST', '/auth/refresh', { cookie: sess.cookie });
  assert.equal(r1.status, 200);
  assert.notEqual(r1.cookie, sess.cookie, 'cookie novo a cada renovação');

  // Reapresentar o token antigo (fora da janela de tolerância) = roubo presumido.
  const reuse = await call('POST', '/auth/refresh', { cookie: sess.cookie });
  assert.equal(reuse.status, 401);
  const afterReuse = await call('POST', '/auth/refresh', { cookie: r1.cookie });
  assert.equal(afterReuse.status, 401, 'a cadeia inteira foi revogada');
  assert.equal((await call('GET', '/auth/me', { token: r1.body.accessToken })).status, 401);

  const logs = await call('GET', '/audit-logs?action=TOKEN_REUSE', { token: s.admin.token });
  assert.ok(logs.body.total >= 1);
});

test('troca de senha encerra as outras sessões', async () => {
  const a = await login(physioEmail, PASS, '10.0.6.1');
  const b = await login(physioEmail, PASS, '10.0.6.2');
  const sessions = await call('GET', '/auth/sessions', { token: a.token });
  assert.ok(sessions.body.length >= 2);
  const wrong = await call('POST', '/auth/change-password', { token: a.token, body: { currentPassword: 'errada123', newPassword: 'NovaSenha456' } });
  assert.equal(wrong.status, 400);
  const ok = await call('POST', '/auth/change-password', { token: a.token, body: { currentPassword: PASS, newPassword: 'NovaSenha456' } });
  assert.equal(ok.status, 204);
  assert.equal((await call('GET', '/auth/me', { token: a.token })).status, 200, 'sessão atual continua');
  assert.equal((await call('GET', '/auth/me', { token: b.token })).status, 401, 'outra sessão encerrada');
});

test('recuperação de senha: resposta neutra e link de uso único', async () => {
  const unknown = await call('POST', '/auth/forgot-password', { body: { email: `ninguem-${uniq}@teste.local` }, ip: '10.0.7.1' });
  const known = await call('POST', '/auth/forgot-password', { body: { email: physioEmail }, ip: '10.0.7.2' });
  assert.equal(unknown.status, 200);
  assert.deepEqual(unknown.body, known.body, 'não revela se o e-mail existe');
  const token = await lastMailTo(physioEmail);
  assert.equal((await call('POST', '/auth/reset-password', { body: { token, password: 'curta' } })).status, 400);
  assert.equal((await call('POST', '/auth/reset-password', { body: { token, password: PASS } })).status, 200);
  await login(physioEmail, PASS, '10.0.7.3');
});

test('bloqueio após 5 tentativas erradas', async () => {
  for (let i = 0; i < 5; i++) {
    const r = await call('POST', '/auth/login', { body: { email: physioEmail, password: 'errada000' }, ip: '10.0.8.1' });
    assert.equal(r.status, i < 4 ? 401 : 423);
  }
  const correct = await call('POST', '/auth/login', { body: { email: physioEmail, password: PASS }, ip: '10.0.8.2' });
  assert.equal(correct.status, 423, 'bloqueado mesmo com a senha certa');
  assert.equal((await call('POST', `/users/${s.physioId}/unlock`, { token: s.admin.token })).status, 201);
  await login(physioEmail, PASS, '10.0.8.3');
});

test('auditoria registra as ações e é imutável no banco', async () => {
  const logs = await call('GET', '/audit-logs?pageSize=100', { token: s.admin.token });
  const actions = new Set(logs.body.items.map((l: any) => l.action));
  for (const a of ['CREATE', 'UPDATE', 'LOGIN', 'LOGIN_FAILED', 'PERMISSION_CHANGE', 'PASSWORD_RESET', 'PASSWORD_CHANGE']) {
    assert.ok(actions.has(a), `ação ${a} deveria estar no log`);
  }
  assert.ok(!JSON.stringify(logs.body).includes('passwordHash'), 'hash de senha nunca aparece no log');

  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE audit_logs SET summary = 'adulterado' WHERE "organizationId" = '${s.orgId}'`), /imutável/);
  await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM audit_logs WHERE "organizationId" = '${s.orgId}'`), /imutável/);
});

test('logout revoga a sessão', async () => {
  const sess = await login(receptionEmail, PASS, '10.0.9.1');
  const out = await call('POST', '/auth/logout', { cookie: sess.cookie });
  assert.equal(out.status, 204);
  assert.equal((await call('GET', '/auth/me', { token: sess.token })).status, 401);
  assert.equal((await call('POST', '/auth/refresh', { cookie: sess.cookie })).status, 401);
  await prisma.$disconnect();
});

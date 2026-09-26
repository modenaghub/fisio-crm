import assert from 'node:assert/strict';

export const API = process.env.API_URL ?? 'http://localhost:3000/api/v1';
let ipCounter = Math.floor(Math.random() * 200);

export type Res = { status: number; body: any; cookie?: string };

export async function call(method: string, path: string, opts: { token?: string; body?: unknown; cookie?: string; ip?: string; raw?: boolean } = {}): Promise<Res> {
  const headers: Record<string, string> = { 'x-forwarded-for': opts.ip ?? `10.${(ipCounter++ % 250) + 1}.0.1` };
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  const r = await fetch(API + path, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const text = await r.text();
  let body: any = text;
  if (!opts.raw) {
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
  }
  return { status: r.status, body, cookie: r.headers.get('set-cookie')?.split(';')[0] };
}

export function ok(r: Res, status = 200, msg = '') {
  assert.equal(r.status, status, `${msg} → ${r.status}: ${typeof r.body === 'string' ? r.body.slice(0, 300) : JSON.stringify(r.body).slice(0, 500)}`);
  return r.body;
}

export async function login(email: string, password: string) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  ok(r, 200, `login ${email}`);
  return r.body.accessToken as string;
}

export const PASS = 'Senha123forte';

/** Clínica nova com admin, dois fisioterapeutas e recepção. */
export async function makeClinic(label: string) {
  const uniq = `${label}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const reg = await call('POST', '/auth/register', {
    body: { organizationName: `Clínica ${uniq}`, name: 'Admin Teste', email: `admin-${uniq}@t.local`, password: PASS, acceptTerms: true },
  });
  ok(reg, 201, 'register');
  const admin = reg.body.accessToken as string;
  // Configuração mínima: horários seg–sex 08–12 / 13–19 e serviços.
  ok(await call('PUT', '/onboarding/steps/5', { token: admin, body: { days: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, intervals: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '19:00' }] })) } }), 200, 'hours');
  ok(await call('PUT', '/onboarding/steps/6', { token: admin, body: { defaultSessionPriceCents: 12000, defaultSessionMinutes: 50, evaluationPriceCents: 15000 } }), 200, 'price');
  ok(await call('POST', '/onboarding/complete', { token: admin }), 200, 'complete');
  const roles = ok(await call('GET', '/roles', { token: admin }));
  const roleId = (k: string) => roles.find((r: any) => r.key === k).id;
  const mk = async (name: string, key: string, prof: boolean) => {
    const email = `${name.toLowerCase().replace(/\W/g, '')}-${uniq}@t.local`;
    const u = ok(await call('POST', '/users', { token: admin, body: { name, email, roleId: roleId(key), password: PASS, isProfessional: prof } }), 201, `user ${name}`);
    return { id: u.id as string, email, token: await login(email, PASS) };
  };
  const me = ok(await call('GET', '/auth/me', { token: admin }));
  return {
    uniq,
    orgId: me.organization.id as string,
    admin: { id: me.user.id as string, token: admin },
    physioA: await mk('Fisio Alfa', 'PHYSIO', true),
    physioB: await mk('Fisio Beta', 'PHYSIO', true),
    reception: await mk('Recepcao Gama', 'RECEPTION', false),
    roleId,
  };
}

/** CPF válido gerado a partir de 9 dígitos. */
export function cpf(seed: number) {
  const base = String(100000000 + (seed % 899999999)).padStart(9, '0').split('').map(Number);
  const dv = (arr: number[]) => {
    const len = arr.length + 1;
    const s = arr.reduce((acc, n, i) => acc + n * (len - i), 0);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  const d1 = dv(base);
  const d2 = dv([...base, d1]);
  return [...base, d1, d2].join('');
}

/** Data local (America/Sao_Paulo) daqui a N dias, no formato YYYY-MM-DD, pulando fins de semana se pedido. */
export function dayFromNow(n: number, weekdayOnly = true) {
  const d = new Date(Date.now() - 3 * 3600e3);
  d.setUTCDate(d.getUTCDate() + n);
  if (weekdayOnly) while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeClinic, ok } from './helpers';

let c: Awaited<ReturnType<typeof makeClinic>>;
const s: Record<string, any> = {};
const shift = (n: number) => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('setup', async () => {
  c = await makeClinic('dash');
  s.pA = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'Paciente do Alfa', responsibleId: c.physioA.id, healthDataConsent: true } }), 201).id;
  s.pB = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'Paciente do Beta', responsibleId: c.physioB.id, healthDataConsent: true } }), 201).id;
  ok(await call('POST', `/patients/${s.pA}/sessions`, { token: c.physioA.token, body: { evolutionText: 'Sessão realizada hoje.' } }), 201);
  ok(await call('POST', `/patients/${s.pB}/sessions`, { token: c.physioB.token, body: { evolutionText: 'Sessão realizada hoje.' } }), 201);
  ok(await call('POST', '/finance/receivables', { token: c.reception.token, body: { patientId: s.pA, description: 'Taxa atrasada', amountCents: 5000, dueDate: shift(-5) } }), 201);
});

test('admin vê a clínica inteira com financeiro', async () => {
  const d = ok(await call('GET', '/dashboard', { token: c.admin.token }));
  assert.equal(d.scope, 'clinic');
  assert.equal(d.canSeeMoney, true);
  assert.equal(d.week.sessions, 2);
  assert.equal(d.month.sessions, 2);
  assert.ok(d.finance);
  assert.equal(d.finance.month.overdueCents >= 5000, true);
  assert.equal(d.trend.length, 8);
  assert.equal(d.trend[7].sessions, 2);
  const keys = d.pending.map((p: any) => p.key);
  assert.ok(keys.includes('overdue'), 'pagamento em atraso vira pendência');
  assert.equal(d.counts.pending, d.pending.length);
});

test('fisioterapeuta vê só a própria agenda e sem valores', async () => {
  const d = ok(await call('GET', '/dashboard', { token: c.physioA.token }));
  assert.equal(d.scope, 'mine');
  assert.equal(d.canSeeMoney, false);
  assert.equal(d.finance, null);
  assert.equal(d.week.sessions, 1);
  assert.equal(d.trend[7].sessions, 1);
});

test('recepção vê operação sem relatório financeiro', async () => {
  const d = ok(await call('GET', '/dashboard', { token: c.reception.token }));
  assert.equal(d.finance, null);
  assert.ok(d.pending.some((p: any) => p.key === 'overdue'), 'recepção cobra atrasados');
});

test('consulta de hoje sem confirmação vira pendência', async () => {
  // Um horário livre ainda hoje (se houver); se o expediente já acabou, o teste só confere o formato.
  const slots = ok(await call('GET', `/schedule/slots?professionalId=${c.physioA.id}&date=${shift(0)}`, { token: c.reception.token }));
  const free = (slots as string[]).find((x) => new Date(x) > new Date(Date.now() + 10 * 60e3));
  if (!free) return;
  ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.pA, professionalId: c.physioA.id, startsAt: free } }), 201);
  const d = ok(await call('GET', '/dashboard', { token: c.physioA.token }));
  assert.ok(d.pending.some((p: any) => p.key === 'unconfirmed'));
  assert.ok(d.today.appointments >= 1);
});

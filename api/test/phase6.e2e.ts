import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, dayFromNow, makeClinic, ok } from './helpers';

let c: Awaited<ReturnType<typeof makeClinic>>;
const s: Record<string, any> = {};
const at = (date: string, time: string) => `${date}T${time}:00-03:00`;
const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const shift = (n: number) => { const d = new Date(Date.now() - 3 * 3600e3); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

test('setup', async () => {
  c = await makeClinic('fin');
  s.p1 = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'Paciente Pacote', responsibleId: c.physioA.id, healthDataConsent: true } }), 201).id;
  s.p2 = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'Paciente Avulso', responsibleId: c.physioA.id, healthDataConsent: true } }), 201).id;
});

test('modelo de pacote e venda parcelada', async () => {
  assert.equal((await call('POST', '/finance/package-templates', { token: c.reception.token, body: { name: 'X', sessions: 1, priceCents: 1 } })).status, 403);
  const t = ok(await call('POST', '/finance/package-templates', { token: c.admin.token, body: { name: 'Pacote 10 sessões', sessions: 10, priceCents: 100000, validityDays: 120 } }), 201);
  const pkg = ok(await call('POST', `/patients/${s.p1}/packages`, { token: c.reception.token, body: { templateId: t.id, startDate: today(), installments: 3, paidNowMethod: 'PIX' } }), 201);
  assert.equal(pkg.contracted, 10);
  assert.equal(pkg.perSessionCents, 10000);
  assert.equal(pkg.paidCents, 33334);
  assert.equal(pkg.openCents, 66666);
  assert.ok(pkg.expectedEndDate, 'validade do modelo define a previsão de término');
  s.pkg = pkg.id;
  const rec = ok(await call('GET', `/finance/receivables?patientId=${s.p1}`, { token: c.reception.token }));
  assert.deepEqual(rec.items.map((i: any) => [i.installment, i.amountCents, i.status]), [[1, 33334, 'PAID'], [2, 33333, 'PENDING'], [3, 33333, 'PENDING']]);
});

test('sessão desconta do pacote vendido', async () => {
  const r = ok(await call('POST', `/patients/${s.p1}/sessions`, { token: c.physioA.token, body: { evolutionText: 'Primeira sessão do pacote.' } }), 201);
  assert.equal(r.billing.packageId, s.pkg);
  const list = ok(await call('GET', `/patients/${s.p1}/packages`, { token: c.reception.token }));
  assert.equal(list[0].remaining, 9);
  const p = ok(await call('GET', `/patients/${s.p1}`, { token: c.reception.token }));
  assert.equal(p.activePackage.remaining, 9);
});

test('recebimento parcial, total e validações', async () => {
  const r = ok(await call('POST', `/patients/${s.p2}/sessions`, { token: c.physioA.token, body: { evolutionText: 'Sessão avulsa sem pacote.' } }), 201);
  s.pay = r.billing.paymentId;
  assert.equal((await call('POST', `/finance/receivables/${s.pay}/pay`, { token: c.reception.token, body: { amountCents: 99999, method: 'PIX' } })).status, 400, 'maior que o saldo');
  assert.equal((await call('POST', `/finance/receivables/${s.pay}/pay`, { token: c.reception.token, body: { amountCents: 5000, method: 'BOLETO' } })).status, 400, 'forma não aceita');
  const part = ok(await call('POST', `/finance/receivables/${s.pay}/pay`, { token: c.reception.token, body: { amountCents: 5000, method: 'CASH' } }));
  assert.equal(part.status, 'PARTIAL');
  assert.equal(part.openCents, 7000);
  const full = ok(await call('POST', `/finance/receivables/${s.pay}/pay`, { token: c.reception.token, body: { amountCents: 7000, method: 'CREDIT_CARD' } }));
  assert.equal(full.status, 'PAID');
  assert.equal(full.transactions.length, 2);
  assert.equal((await call('POST', `/finance/receivables/${s.pay}/cancel`, { token: c.reception.token, body: { reason: 'Engano' } })).status, 409);
});

test('cobrança avulsa atrasada e cancelamento', async () => {
  const late = ok(await call('POST', '/finance/receivables', { token: c.reception.token, body: { patientId: s.p2, description: 'Taxa de relatório', amountCents: 8000, dueDate: shift(-3) } }), 201);
  assert.equal(late.status, 'OVERDUE');
  const overdue = ok(await call('GET', '/finance/receivables?status=OVERDUE', { token: c.reception.token }));
  assert.equal(overdue.items.length, 1);
  assert.equal(overdue.totals.openCents, 8000);
  const x = ok(await call('POST', '/finance/receivables', { token: c.reception.token, body: { description: 'Lançado por engano', amountCents: 1000, dueDate: today() } }), 201);
  const canc = ok(await call('POST', `/finance/receivables/${x.id}/cancel`, { token: c.reception.token, body: { reason: 'Duplicado' } }));
  assert.equal(canc.status, 'CANCELLED');
});

test('despesas: recorrência e pagamento; recepção sem acesso', async () => {
  assert.equal((await call('GET', '/finance/expenses', { token: c.reception.token })).status, 403);
  const cats = ok(await call('GET', '/finance/expense-categories', { token: c.admin.token }));
  const rent = cats.find((x: any) => x.name === 'Aluguel');
  const r = ok(await call('POST', '/finance/expenses', { token: c.admin.token, body: { categoryId: rent.id, description: 'Aluguel da sala', amountCents: 250000, dueDate: today(), repeatMonths: 3, paidNowMethod: 'BANK_TRANSFER' } }), 201);
  assert.equal(r.created, 3);
  const list = ok(await call('GET', '/finance/expenses', { token: c.admin.token }));
  assert.equal(list.items.length, 3);
  assert.equal(list.items[0].status, 'PAID');
  assert.equal(list.totals.openCents, 500000);
});

test('resumo, caixa e inadimplência', async () => {
  assert.equal((await call('GET', `/finance/summary?from=${today()}&to=${today()}`, { token: c.reception.token })).status, 403);
  const sum = ok(await call('GET', `/finance/summary?from=${shift(-30)}&to=${today()}`, { token: c.admin.token }));
  assert.equal(sum.receivedCents, 33334 + 12000);
  assert.equal(sum.expensesPaidCents, 250000);
  assert.equal(sum.balanceCents, 45334 - 250000);
  assert.equal(sum.overdueCents, 8000);
  assert.equal(sum.sessions, 2);
  assert.ok(sum.byMethod.PIX === 33334 && sum.byMethod.CASH === 5000);
  const cash = ok(await call('GET', `/finance/transactions?from=${today()}&to=${today()}`, { token: c.admin.token }));
  assert.equal(cash.totals.inCents, 45334);
  const monthly = ok(await call('GET', '/finance/monthly', { token: c.admin.token }));
  assert.equal(monthly.length, 6);
});

test('projeção: agenda × valor, pacotes, perdida', async () => {
  const d = dayFromNow(2);
  // p2 sem pacote: conta na agenda; p1 com pacote: não duplica.
  ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p2, professionalId: c.physioA.id, startsAt: at(d, '09:00') } }), 201);
  ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p2, professionalId: c.physioA.id, startsAt: at(d, '10:00') } }), 201);
  ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p1, professionalId: c.physioA.id, startsAt: at(d, '11:00') } }), 201);
  const cancelled = ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p2, professionalId: c.physioB.id, startsAt: at(d, '09:00') } }), 201);
  ok(await call('POST', `/appointments/${cancelled.id}/status`, { token: c.reception.token, body: { status: 'CANCELLED' } }));
  const pr = ok(await call('GET', '/finance/projection', { token: c.admin.token }));
  assert.equal(pr.windows.length, 7);
  const w = pr.windows.find((x: any) => x.key === '3m');
  assert.equal(w.breakdown.agendaSessions, 2);
  assert.equal(w.breakdown.agendaCents, 24000);
  assert.equal(w.breakdown.packageCoveredSessions, 1);
  assert.equal(w.breakdown.packagesCents, 66666);
  assert.equal(w.expectedCents, 24000 + 66666);
  assert.ok(w.potentialCents > w.expectedCents, 'horários livres somam ao potencial');
  assert.equal(w.lostCents, 12000);
  assert.equal(pr.overdueCents, 8000);
});

test('metas do mês', async () => {
  const month = today().slice(0, 7);
  const g = ok(await call('PUT', '/finance/goals', { token: c.admin.token, body: { month, revenueCents: 2000000, sessions: 200, newPatients: 30 } }));
  const rev = g.items.find((i: any) => i.metric === 'REVENUE');
  assert.equal(rev.target, 2000000);
  assert.ok(rev.realized > 0 && rev.percent > 0 && rev.projection >= rev.realized);
  const ses = g.items.find((i: any) => i.metric === 'SESSIONS');
  assert.equal(ses.realized, 2);
  assert.equal((await call('PUT', '/finance/goals', { token: c.reception.token, body: { month, sessions: 1 } })).status, 403);
  const read = ok(await call('GET', `/finance/goals?month=${month}`, { token: c.physioA.token }));
  assert.equal(read.items.length, 3);
});

test('cancelar pacote cancela parcelas em aberto', async () => {
  const p = ok(await call('PATCH', `/finance/packages/${s.pkg}`, { token: c.reception.token, body: { status: 'CANCELLED' } }));
  assert.equal(p.status, 'CANCELLED');
  const rec = ok(await call('GET', `/finance/receivables?patientId=${s.p1}&status=CANCELLED`, { token: c.reception.token }));
  assert.equal(rec.items.length, 2);
});

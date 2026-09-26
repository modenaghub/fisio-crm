import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, dayFromNow, makeClinic, ok } from './helpers';

let c: Awaited<ReturnType<typeof makeClinic>>;
const s: Record<string, any> = {};
const at = (date: string, time: string) => `${date}T${time}:00-03:00`;

function nextWeekday(target: number, minDaysAhead = 7) {
  const d = new Date(Date.now() - 3 * 3600e3);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() !== target) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

test('setup', async () => {
  c = await makeClinic('agenda');
  s.p = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'Paciente Agenda', responsibleId: c.physioA.id, healthDataConsent: true } }), 201).id;
  s.services = ok(await call('GET', '/settings/services', { token: c.reception.token }));
  s.session = s.services.find((x: any) => x.kind === 'SESSION');
  s.evaluation = s.services.find((x: any) => x.kind === 'EVALUATION');
  s.day = dayFromNow(3);
});

test('agendar respeita horário, conflitos e encaixe', async () => {
  const a = ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, serviceId: s.session.id, startsAt: at(s.day, '09:00') } }), 201);
  assert.equal(a.durationMinutes, 50);
  assert.equal(a.priceCents, 12000);
  assert.equal(a.status, 'SCHEDULED');
  s.a1 = a.id;
  const clash = await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: at(s.day, '09:30') } });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.code, 'CONFLICT');
  assert.equal(clash.body.canForce, false, 'encaixe desativado por padrão');
  const lunch = await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: at(s.day, '12:15') } });
  assert.equal(lunch.body.code, 'OUTSIDE_HOURS');
  const extra = ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: at(s.day, '12:15'), durationMinutes: 30, force: true } }), 201);
  s.extra = extra.id;
  const other = ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioB.id, startsAt: at(s.day, '09:00') } }), 201);
  assert.ok(other.id, 'outro profissional no mesmo horário');
  assert.equal((await call('POST', '/appointments', { token: c.reception.token, body: { professionalId: c.physioA.id, startsAt: at(s.day, '15:00') } })).status, 400, 'paciente obrigatório');
});

test('bloqueio de horário', async () => {
  const b = ok(await call('POST', '/appointments', { token: c.physioA.token, body: { kind: 'BLOCK', professionalId: c.physioA.id, startsAt: at(s.day, '16:00'), durationMinutes: 60, notes: 'Reunião' } }), 201);
  assert.equal(b.status, 'BLOCKED');
  assert.equal((await call('POST', '/appointments', { token: c.physioA.token, body: { kind: 'BLOCK', professionalId: c.physioB.id, startsAt: at(s.day, '16:00') } })).status, 400);
  const clash = await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: at(s.day, '16:30') } });
  assert.equal(clash.body.code, 'CONFLICT');
});

test('status, mover e reagendar', async () => {
  ok(await call('POST', `/appointments/${s.a1}/status`, { token: c.reception.token, body: { status: 'CONFIRMED' } }));
  assert.equal((await call('POST', `/appointments/${s.a1}/status`, { token: c.reception.token, body: { status: 'NO_SHOW' } })).status, 400, 'falta só depois do horário');
  const moved = ok(await call('PATCH', `/appointments/${s.a1}`, { token: c.reception.token, body: { startsAt: at(s.day, '10:00') } }));
  assert.equal(moved.status, 'SCHEDULED', 'mudou o horário: precisa confirmar de novo');
  const r = ok(await call('POST', `/appointments/${s.a1}/reschedule`, { token: c.reception.token, body: { startsAt: at(s.day, '14:00'), reason: 'Paciente pediu' } }), 201);
  assert.equal(r.rescheduledFromId, s.a1);
  const old = ok(await call('GET', `/appointments/${s.a1}`, { token: c.reception.token }));
  assert.equal(old.status, 'RESCHEDULED');
  assert.ok(old.history.length >= 3);
  s.a2 = r.id;
  const list = ok(await call('GET', `/appointments?from=${at(s.day, '00:00')}&to=${at(s.day, '23:59')}&professionalId=${c.physioA.id}`, { token: c.physioA.token }));
  assert.ok(!list.some((x: any) => x.id === s.a1), 'reagendado some da grade');
  assert.ok(list.some((x: any) => x.id === s.a2));
  ok(await call('POST', `/appointments/${s.extra}/status`, { token: c.reception.token, body: { status: 'CANCELLED', reason: 'Desistiu' } }));
});

test('atendimento realizado fecha o agendamento', async () => {
  // Agendamento no passado recente (retroativo) para permitir o registro.
  const past = new Date(Date.now() - 2 * 3600e3).toISOString();
  const a = ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, serviceId: s.session.id, startsAt: past, force: true } }), 201);
  const r = ok(await call('POST', `/patients/${s.p}/sessions`, { token: c.physioA.token, body: { appointmentId: a.id, evolutionText: 'Sessão realizada a partir da agenda.' } }), 201);
  assert.equal(r.sessionNumber, 1);
  const after = ok(await call('GET', `/appointments/${a.id}`, { token: c.reception.token }));
  assert.equal(after.status, 'DONE');
  assert.equal(after.session.sessionNumber, 1);
  assert.equal((await call('POST', `/appointments/${a.id}/status`, { token: c.reception.token, body: { status: 'CANCELLED' } })).status, 400);
  assert.equal((await call('POST', `/patients/${s.p}/sessions`, { token: c.physioA.token, body: { appointmentId: a.id, evolutionText: 'Duplicado não pode.' } })).status, 409);
});

test('agendamento recorrente: prévia, conflitos e criação', async () => {
  const start = nextWeekday(1, 14); // segunda-feira daqui a ~2 semanas
  const tue = new Date(`${start}T12:00:00Z`); tue.setUTCDate(tue.getUTCDate() + 1);
  const firstTue = tue.toISOString().slice(0, 10);
  ok(await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: at(firstTue, '15:00') } }), 201);
  const end = new Date(`${start}T12:00:00Z`); end.setUTCDate(end.getUTCDate() + 27);
  const body = { patientId: s.p, professionalId: c.physioA.id, serviceId: s.session.id, weekdays: [2, 4], time: '15:00', startDate: start, endDate: end.toISOString().slice(0, 10) };
  const preview = ok(await call('POST', '/appointments/recurring', { token: c.reception.token, body: { ...body, dryRun: true } }), 201);
  assert.equal(preview.total, 8, '2x por semana por 4 semanas');
  assert.equal(preview.conflicts.length, 1);
  const blocked = await call('POST', '/appointments/recurring', { token: c.reception.token, body });
  assert.equal(blocked.status, 409);
  const created = ok(await call('POST', '/appointments/recurring', { token: c.reception.token, body: { ...body, skipConflicts: true } }), 201);
  assert.equal(created.created, 7);
  s.series = created.seriesId;
  const pa = ok(await call('GET', `/patients/${s.p}/appointments`, { token: c.reception.token }));
  assert.ok(pa.summary.future >= 8);
  assert.equal(pa.summary.done, 1);
  assert.equal(pa.summary.cancelled, 1);
  assert.equal(pa.series.length, 1);
  const cancel = ok(await call('POST', `/recurrence/${s.series}/cancel`, { token: c.reception.token, body: { reason: 'Mudou de cidade' } }));
  assert.equal(cancel.cancelled, 7);
});

test('recorrência limitada pelo saldo do pacote', async () => {
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  const pkg = await prisma.package.create({ data: { organizationId: c.orgId, patientId: s.p, name: 'Pacote 5', contractedSessions: 5, totalPriceCents: 50000, startDate: new Date() } });
  const r = ok(await call('POST', '/appointments/recurring', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioB.id, weekdays: [1, 3, 5], time: '08:00', startDate: nextWeekday(1, 21), packageId: pkg.id, dryRun: true } }), 201);
  assert.equal(r.total, 5);
  await prisma.$disconnect();
});

test('folga, feriados e horário próprio do profissional', async () => {
  const d = dayFromNow(5);
  ok(await call('POST', '/schedule/exceptions', { token: c.physioA.token, body: { kind: 'DAY_OFF', professionalId: c.physioA.id, startsAt: at(d, '00:00'), endsAt: at(d, '23:59'), reason: 'Congresso' } }), 201);
  assert.equal((await call('POST', '/schedule/exceptions', { token: c.physioA.token, body: { kind: 'DAY_OFF', professionalId: c.physioB.id, startsAt: at(d, '00:00'), endsAt: at(d, '23:59') } })).status, 400);
  const off = await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: at(d, '09:00') } });
  assert.equal(off.body.code, 'OUTSIDE_HOURS');
  const slots = ok(await call('GET', `/schedule/slots?professionalId=${c.physioA.id}&date=${d}`, { token: c.reception.token }));
  assert.equal(slots.length, 0);
  const slotsB = ok(await call('GET', `/schedule/slots?professionalId=${c.physioB.id}&date=${d}`, { token: c.reception.token }));
  assert.ok(slotsB.length > 5);

  const hol = ok(await call('POST', '/schedule/holidays/national', { token: c.admin.token, body: { year: 2027 } }), 201);
  assert.ok(hol.some((h: any) => h.date === '2027-03-26' && /Sexta-feira Santa/.test(h.name)));
  const tira = await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: at('2027-04-21', '09:00') } });
  assert.equal(tira.body.code, 'OUTSIDE_HOURS', 'Tiradentes');

  ok(await call('PUT', `/schedule/professionals/${c.physioB.id}/hours`, { token: c.physioB.token, body: { days: [{ weekday: 1, intervals: [{ start: '08:00', end: '10:00' }] }] } }));
  const tue = nextWeekday(2, 7);
  const bTue = await call('POST', '/appointments', { token: c.reception.token, body: { patientId: s.p, professionalId: c.physioB.id, startsAt: at(tue, '09:00') } });
  assert.equal(bTue.body.code, 'OUTSIDE_HOURS', 'profissional só atende segunda');
  assert.equal((await call('PUT', `/schedule/professionals/${c.physioA.id}/hours`, { token: c.physioB.token, body: { days: [] } })).status, 400);
});

test('ocupação e agenda do dia', async () => {
  const occ = ok(await call('GET', `/schedule/occupancy?from=${at(s.day, '00:00')}&to=${at(s.day, '23:59')}`, { token: c.admin.token }));
  assert.ok(occ.availableMin > 0);
  assert.ok(occ.rate > 0 && occ.rate < 1);
  const today = ok(await call('GET', '/appointments/today', { token: c.physioA.token }));
  assert.ok(Array.isArray(today));
  const logs = ok(await call('GET', '/audit-logs?entity=appointment', { token: c.admin.token }));
  assert.ok(logs.total >= 5);
});

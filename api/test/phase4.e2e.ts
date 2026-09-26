import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { call, makeClinic, ok } from './helpers';

const prisma = new PrismaClient();
let c: Awaited<ReturnType<typeof makeClinic>>;
const s: Record<string, any> = {};

test('setup: clínica e paciente do fisioterapeuta A', async () => {
  c = await makeClinic('pront');
  const p = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'Paciente Prontuário', responsibleId: c.physioA.id, healthDataConsent: true } }), 201);
  s.pid = p.id;
});

test('recepção não acessa prontuário sem permissão', async () => {
  assert.equal((await call('GET', `/patients/${s.pid}/clinical-profile`, { token: c.reception.token })).status, 403);
  assert.equal((await call('GET', `/patients/${s.pid}/sessions`, { token: c.reception.token })).status, 403);
  assert.equal((await call('GET', `/patients/${s.pid}/clinical-profile`, { token: c.physioB.token })).status, 404, 'fisioterapeuta de outro paciente');
});

test('dados clínicos e condições', async () => {
  const r = ok(await call('PUT', `/patients/${s.pid}/clinical-profile`, { token: c.physioA.token, body: { mainComplaint: 'Dor no ombro direito', diagnosis: 'Tendinopatia do supraespinhal', allergies: 'Dipirona', medications: '' } }));
  assert.equal(r.profile.diagnosis, 'Tendinopatia do supraespinhal');
  assert.equal(r.profile.medications, null);
  const cond = ok(await call('POST', `/patients/${s.pid}/conditions`, { token: c.physioA.token, body: { type: 'INJURY', description: 'Lesão do manguito rotador', icd10Code: 'M75.1', bodyRegion: 'Ombro', laterality: 'direito', since: '2026-06-01' } }), 201);
  ok(await call('PATCH', `/patients/${s.pid}/conditions/${cond.id}`, { token: c.physioA.token, body: { isActive: false } }));
  assert.equal((await call('DELETE', `/patients/${s.pid}/conditions/${cond.id}`, { token: c.physioA.token })).status, 403, 'fisioterapeuta não exclui');
  const cat = ok(await call('GET', '/clinical/conditions-catalog?q=manguito', { token: c.physioA.token }));
  assert.equal(cat[0].icd10Code, 'M75.1');
});

test('avaliação com amplitude, força, testes e escalas', async () => {
  const bad = await call('POST', `/patients/${s.pid}/evaluations`, { token: c.physioA.token, body: { type: 'INITIAL', performedAt: new Date().toISOString(), painScale: 14 } });
  assert.equal(bad.status, 400);
  const e = ok(await call('POST', `/patients/${s.pid}/evaluations`, {
    token: c.physioA.token,
    body: {
      type: 'INITIAL', performedAt: new Date().toISOString(), painScale: 7, mainComplaint: 'Dor ao elevar o braço', mobility: 'Limitação na elevação', posture: 'Protração de ombros',
      rangeOfMotion: [{ joint: 'Ombro', movement: 'Flexão', side: 'D', degrees: 120 }],
      strength: [{ muscle: 'Supraespinhal', side: 'D', grade: 3 }],
      tests: [{ name: 'Jobe', result: 'positivo' }],
      scales: [{ name: 'DASH', score: '42' }],
      conclusion: 'Quadro compatível com tendinopatia',
    },
  }), 201);
  assert.equal(e.rangeOfMotion[0].degrees, 120);
  assert.equal(e.posture, 'Protração de ombros');
  s.evalId = e.id;
  const list = ok(await call('GET', `/patients/${s.pid}/evaluations`, { token: c.physioA.token }));
  assert.equal(list.length, 1);
});

test('plano de tratamento: só um ativo por vez', async () => {
  const p1 = ok(await call('POST', `/patients/${s.pid}/treatment-plans`, { token: c.physioA.token, body: { objective: 'Reduzir dor', treatment: 'Cinesioterapia e terapia manual', frequencyPerWeek: 2, plannedSessions: 10, evaluationId: s.evalId } }), 201);
  const bad = await call('POST', `/patients/${s.pid}/treatment-plans`, { token: c.physioA.token, body: { objective: 'X plano', treatment: 'Y trat', startDate: '2026-10-10', expectedEndDate: '2026-10-01' } });
  assert.equal(bad.status, 400);
  const p2 = ok(await call('POST', `/patients/${s.pid}/treatment-plans`, { token: c.physioA.token, body: { objective: 'Ganho de força', treatment: 'Fortalecimento progressivo', plannedSessions: 12 } }), 201);
  const plans = ok(await call('GET', `/patients/${s.pid}/treatment-plans`, { token: c.physioA.token }));
  assert.equal(plans.find((x: any) => x.id === p1.id).status, 'COMPLETED');
  assert.equal(plans.find((x: any) => x.id === p2.id).status, 'ACTIVE');
  s.planId = p2.id;
});

test('registrar sessão: numeração, cobrança e status do paciente', async () => {
  assert.equal((await call('POST', `/patients/${s.pid}/sessions`, { token: c.physioA.token, body: { evolutionText: 'curto' } })).status, 400);
  const future = await call('POST', `/patients/${s.pid}/sessions`, { token: c.physioA.token, body: { evolutionText: 'Sessão no futuro não pode', performedAt: new Date(Date.now() + 5 * 86400e3).toISOString() } });
  assert.equal(future.status, 400);
  const r = ok(await call('POST', `/patients/${s.pid}/sessions`, {
    token: c.physioA.token,
    body: { painScale: 6, procedures: 'Mobilização glenoumeral', exercises: 'Pendular, isometria', evolutionText: 'Paciente apresentou melhora da mobilidade do ombro direito. Relatou redução da dor.' },
  }), 201);
  assert.equal(r.sessionNumber, 1);
  assert.ok(r.billing.paymentId, 'sem pacote: gera conta a receber');
  const pay = await prisma.payment.findUniqueOrThrow({ where: { id: r.billing.paymentId } });
  assert.equal(pay.amountCents, 12000);
  const p = ok(await call('GET', `/patients/${s.pid}`, { token: c.physioA.token }));
  assert.equal(p.crmStage, 'IN_TREATMENT');
  assert.equal(p.sessionsDone, 1);
  s.session1 = r.id;
});

test('pacote: sessão desconta automaticamente', async () => {
  const pkg = await prisma.package.create({ data: { organizationId: c.orgId, patientId: s.pid, name: 'Pacote 2 sessões', contractedSessions: 2, totalPriceCents: 20000, startDate: new Date() } });
  s.pkg = pkg.id;
  const r2 = ok(await call('POST', `/patients/${s.pid}/sessions`, { token: c.physioA.token, body: { evolutionText: 'Segunda sessão: exercícios de fortalecimento.' } }), 201);
  assert.equal(r2.sessionNumber, 2);
  assert.equal(r2.billing.packageId, pkg.id);
  assert.equal(r2.billing.remaining, 1);
  const r3 = ok(await call('POST', `/patients/${s.pid}/sessions`, { token: c.physioA.token, body: { evolutionText: 'Terceira sessão: progressão de carga.' } }), 201);
  assert.equal(r3.billing.remaining, 0);
  assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: pkg.id } })).status, 'COMPLETED');
  s.session3 = r3.id;
  const r4 = ok(await call('POST', `/patients/${s.pid}/sessions`, { token: c.physioA.token, body: { evolutionText: 'Quarta sessão: pacote já esgotado.' } }), 201);
  assert.ok(r4.billing.paymentId, 'pacote esgotado volta a cobrar avulso');
});

test('editar evolução gera nova versão e preserva a anterior', async () => {
  assert.equal((await call('PATCH', `/clinical/sessions/${s.session1}/evolution`, { token: c.physioA.token, body: { evolutionText: 'Texto corrigido da primeira sessão.' } })).status, 400, 'motivo obrigatório');
  const e = ok(await call('PATCH', `/clinical/sessions/${s.session1}/evolution`, { token: c.physioA.token, body: { evolutionText: 'Texto corrigido da primeira sessão, com mais detalhes.', painScale: 5, editReason: 'Complemento do registro' } }));
  assert.equal(e.version, 2);
  const v = ok(await call('GET', `/clinical/sessions/${s.session1}/versions`, { token: c.admin.token }));
  assert.equal(v.length, 2);
  assert.match(v[1].evolutionText, /melhora da mobilidade/);
  await assert.rejects(prisma.$executeRawUnsafe(`UPDATE session_evolution_versions SET "evolutionText" = 'adulterado' WHERE id = '${v[1].id}'`), /imutável/);
  await assert.rejects(prisma.$executeRawUnsafe(`DELETE FROM session_evolution_versions WHERE id = '${v[1].id}'`), /imutável/);
});

test('exclusão só pelo administrador, com motivo, estornando o pacote', async () => {
  assert.equal((await call('DELETE', `/clinical/sessions/${s.session3}`, { token: c.physioA.token, body: { reason: 'Registro duplicado' } })).status, 403);
  assert.equal((await call('DELETE', `/clinical/sessions/${s.session3}`, { token: c.admin.token, body: {} })).status, 400);
  assert.equal((await call('DELETE', `/clinical/sessions/${s.session3}`, { token: c.admin.token, body: { reason: 'Registro duplicado' } })).status, 204);
  const list = ok(await call('GET', `/patients/${s.pid}/sessions`, { token: c.physioA.token }));
  const del = list.find((x: any) => x.id === s.session3);
  assert.equal(del.deleted, true);
  assert.equal(del.content, null);
  assert.equal((await prisma.package.findUniqueOrThrow({ where: { id: s.pkg } })).status, 'ACTIVE', 'pacote volta a ter saldo');
});

test('acesso ao prontuário é registrado e aparece na linha do tempo', async () => {
  const logs = ok(await call('GET', '/audit-logs?entity=clinical_record&action=READ', { token: c.admin.token }));
  assert.ok(logs.total >= 1);
  const t = ok(await call('GET', `/patients/${s.pid}/timeline`, { token: c.physioA.token }));
  const types = t.events.map((e: any) => e.type);
  for (const k of ['evaluation', 'plan', 'session']) assert.ok(types.includes(k), k);
  const rec = ok(await call('GET', '/clinical/sessions', { token: c.physioA.token }));
  assert.equal(rec.length, 4);
  const ov = ok(await call('GET', '/clinical/overview', { token: c.physioA.token }));
  assert.equal(ov[0].sessions, 4);
  await prisma.$disconnect();
});

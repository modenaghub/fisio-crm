import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, cpf, login, makeClinic, ok } from './helpers';

let c: Awaited<ReturnType<typeof makeClinic>>;
const s: Record<string, any> = {};

test('setup', async () => {
  c = await makeClinic('crm');
});

test('lead: cadastro, movimentação no funil e perda', async () => {
  const bad = await call('POST', '/leads', { token: c.reception.token, body: { name: 'X', phone: '12' } });
  assert.equal(bad.status, 400);
  const l = ok(await call('POST', '/leads', { token: c.reception.token, body: { name: 'Mariana Teste', phone: '(11) 98888-1234', source: 'INSTAGRAM', reason: 'Dor lombar', bodyRegion: 'Lombar', hasDiagnosis: false, previousPhysio: true } }), 201);
  s.lead = l;
  assert.equal(l.stage, 'NEW_CONTACT');
  ok(await call('PATCH', `/leads/${l.id}/stage`, { token: c.reception.token, body: { stage: 'DATA_COLLECTED' } }));
  assert.equal((await call('PATCH', `/leads/${l.id}/stage`, { token: c.reception.token, body: { stage: 'CONVERTED' } })).status, 400, 'conversão só pelo fluxo próprio');
  const lost = ok(await call('POST', '/leads', { token: c.reception.token, body: { name: 'Perdido Teste', phone: '11977776666' } }), 201);
  ok(await call('POST', `/leads/${lost.id}/lost`, { token: c.reception.token, body: { reason: 'Achou caro' } }), 201);
  ok(await call('POST', `/leads/${lost.id}/reopen`, { token: c.reception.token }), 201);
});

test('conversão de lead em paciente com consentimento e prontuário inicial', async () => {
  const doc = cpf(123456);
  const r = ok(await call('POST', `/leads/${s.lead.id}/convert`, { token: c.reception.token, body: { cpf: doc, birthDate: '1990-05-10', sex: 'FEMALE', responsibleId: c.physioA.id, healthDataConsent: true } }), 201);
  assert.match(r.code, /^P-0001$/);
  s.p1 = r.patientId;
  s.cpf1 = doc;
  const again = await call('POST', `/leads/${s.lead.id}/convert`, { token: c.reception.token, body: { healthDataConsent: true } });
  assert.equal(again.status, 400);
  const p = ok(await call('GET', `/patients/${s.p1}`, { token: c.admin.token }));
  assert.equal(p.name, 'Mariana Teste');
  assert.equal(p.cpf, `${doc.slice(0, 3)}.${doc.slice(3, 6)}.${doc.slice(6, 9)}-${doc.slice(9)}`);
  assert.equal(p.crmStage, 'TREATMENT_STARTED');
  assert.equal(p.responsible.id, c.physioA.id);
  assert.equal(p.age >= 30, true);
});

test('paciente: validação de CPF, duplicidade e código sequencial', async () => {
  assert.equal((await call('POST', '/patients', { token: c.reception.token, body: { name: 'CPF Errado', cpf: '123.456.789-00' } })).status, 400);
  assert.equal((await call('POST', '/patients', { token: c.reception.token, body: { name: 'Duplicado', cpf: s.cpf1 } })).status, 409);
  const p2 = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'João Beta Silva', phone: '(19) 3333-2222', whatsapp: '(19) 99999-8888', email: 'joao@t.local', birthDate: '1975-01-20', responsibleId: c.physioB.id, healthDataConsent: true } }), 201);
  assert.equal(p2.code, 'P-0002');
  s.p2 = p2.id;
  const upd = ok(await call('PATCH', `/patients/${s.p2}`, { token: c.reception.token, body: { city: 'Campinas', state: 'SP', whatsapp: '(19) 97777-0000' } }));
  assert.equal(upd.city, 'Campinas');
});

test('busca global por nome, CPF, telefone, e-mail e código', async () => {
  const q = async (term: string) => ok(await call('GET', `/search?q=${encodeURIComponent(term)}`, { token: c.admin.token }));
  assert.equal((await q('mariana')).patients[0]?.id, s.p1);
  assert.equal((await q(s.cpf1)).patients[0]?.id, s.p1, 'CPF completo encontra pelo hash');
  assert.equal((await q('97777')).patients[0]?.id, s.p2, 'telefone atualizado');
  assert.equal((await q('joao@t')).patients[0]?.id, s.p2);
  assert.equal((await q('P-0002')).patients[0]?.id, s.p2);
  assert.equal((await q('Perdido')).leads[0]?.name, 'Perdido Teste');
});

test('fisioterapeuta vê apenas seus pacientes; recepção vê todos', async () => {
  const a = ok(await call('GET', '/patients', { token: c.physioA.token }));
  assert.deepEqual(a.items.map((p: any) => p.id), [s.p1]);
  assert.equal((await call('GET', `/patients/${s.p2}`, { token: c.physioA.token })).status, 404);
  assert.equal((await call('PATCH', `/patients/${s.p2}`, { token: c.physioA.token, body: { city: 'X' } })).status, 404);
  const r = ok(await call('GET', '/patients', { token: c.reception.token }));
  assert.equal(r.total, 2);
  assert.equal((await call('DELETE', `/patients/${s.p1}`, { token: c.physioA.token })).status, 403);
});

test('kanban com as 11 etapas e movimentação de paciente', async () => {
  const b = ok(await call('GET', '/crm/board', { token: c.admin.token }));
  assert.equal(b.columns.length, 11);
  const started = b.columns.find((col: any) => col.key === 'TREATMENT_STARTED');
  assert.equal(started.cards.length, 2);
  const card = started.cards.find((x: any) => x.id === s.p1);
  for (const k of ['name', 'phone', 'birthDate', 'cpf', 'source', 'stage', 'lastContactAt', 'nextAppointment', 'sessionsDone', 'valueCents', 'responsible']) assert.ok(k in card, `card tem ${k}`);
  assert.match(card.cpf, /^\*\*\*\./, 'CPF mascarado no card');
  ok(await call('PATCH', `/patients/${s.p1}/stage`, { token: c.physioA.token, body: { stage: 'ACTIVE' } }));
  const b2 = ok(await call('GET', '/crm/board', { token: c.admin.token }));
  assert.ok(b2.columns.find((col: any) => col.key === 'ACTIVE').cards.some((x: any) => x.id === s.p1));
  const leadsCol = b2.columns.find((col: any) => col.key === 'NEW_CONTACT');
  assert.ok(leadsCol.cards.some((x: any) => x.name === 'Perdido Teste'), 'lead reaberto volta ao início');
});

test('linha do tempo e registro de acesso', async () => {
  const t = ok(await call('GET', `/patients/${s.p1}/timeline`, { token: c.admin.token }));
  const types = t.events.map((e: any) => e.type);
  assert.ok(types.includes('first_contact'));
  assert.ok(types.includes('converted'));
  assert.ok(types.includes('stage'));
  const logs = ok(await call('GET', `/audit-logs?entity=patient&action=READ`, { token: c.admin.token }));
  assert.ok(logs.total >= 1, 'consulta da ficha registrada');
  const clin = ok(await call('GET', `/audit-logs?entity=lead`, { token: c.admin.token }));
  assert.ok(clin.items.some((x: any) => /convertido/.test(x.summary)));
});

test('isolamento entre clínicas', async () => {
  const other = await makeClinic('outra');
  assert.equal((await call('GET', `/patients/${s.p1}`, { token: other.admin.token })).status, 404);
  assert.equal((await call('GET', `/leads/${s.lead.id}`, { token: other.admin.token })).status, 404);
  const srch = ok(await call('GET', `/search?q=${s.cpf1}`, { token: other.admin.token }));
  assert.equal(srch.patients.length, 0);
});

test('exclusão lógica', async () => {
  assert.equal((await call('DELETE', `/patients/${s.p2}`, { token: c.admin.token })).status, 204);
  assert.equal((await call('GET', `/patients/${s.p2}`, { token: c.admin.token })).status, 404);
  const r = ok(await call('GET', '/patients', { token: c.admin.token }));
  assert.equal(r.total, 1);
  void login;
});

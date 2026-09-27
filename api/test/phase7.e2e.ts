import { test } from 'node:test';
import assert from 'node:assert/strict';
import { call, makeClinic, ok } from './helpers';

let c: Awaited<ReturnType<typeof makeClinic>>;
const s: Record<string, any> = {};
// Celular: depois do nono dígito vem 6–9 (é o que permite reconhecer o número que chega sem o 9).
const rnd = () => String(Math.floor(80_000_000 + Math.random() * 19_999_999));
/** Horário "daqui a N horas", arredondado para 5 min. */
const inHours = (h: number) => new Date(Math.ceil((Date.now() + h * 3600e3) / 300e3) * 300e3).toISOString();
const book = async (hours: number) =>
  ok(await call('POST', '/appointments', { token: c.admin.token, body: { patientId: s.p, professionalId: c.physioA.id, startsAt: inHours(hours), force: true } }), 201).id as string;
const inbound = (from: string, text: string, token = c.reception.token) => call('POST', '/communication/simulate', { token, body: { from, text } });
const thread = async (id: string, token = c.reception.token) => ok(await call('GET', `/conversations/${id}`, { token }));

test('setup', async () => {
  c = await makeClinic('com');
  s.local = `11 9${rnd()}`;
  s.p = ok(await call('POST', '/patients', { token: c.reception.token, body: { name: 'Joana Lembrete', whatsapp: `(11) 9${s.local.slice(4, 8)}-${s.local.slice(8)}`, responsibleId: c.physioA.id, healthDataConsent: true } }), 201).id;
  s.e164 = `55${s.local.replace(/\D/g, '')}`;
});

test('fora da janela de 24 h só vai modelo aprovado', async () => {
  const free = await call('POST', `/patients/${s.p}/messages`, { token: c.reception.token, body: { body: 'Oi Joana, tudo bem?' } });
  assert.equal(free.status, 409);
  const m = ok(await call('POST', `/patients/${s.p}/messages`, { token: c.reception.token, body: { templateKey: 'no_return' } }), 201);
  assert.equal(m.status, 'SENT');
  assert.equal(m.isMock, true);
  assert.match(m.body, /Joana/);
});

test('mensagem recebida abre a janela e vincula ao paciente', async () => {
  // Número chega sem o nono dígito, como às vezes vem da Meta.
  const without9 = `55${s.local.replace(/\D/g, '').slice(0, 2)}${s.local.replace(/\D/g, '').slice(3)}`;
  const r = ok(await inbound(without9, 'Bom dia! Posso levar exames na próxima sessão?'), 201);
  s.conv = r.conversationId;
  const list = ok(await call('GET', '/conversations?status=unread', { token: c.admin.token }));
  assert.ok(list.items.some((i: any) => i.id === s.conv), 'aparece como não lida para quem ainda não abriu');
  const t = await thread(s.conv);
  assert.equal(t.patient.id, s.p);
  assert.equal(t.windowOpen, true);
  assert.equal(t.phone, s.e164);
  const sent = ok(await call('POST', `/conversations/${s.conv}/messages`, { token: c.reception.token, body: { body: 'Pode sim, Joana!' } }), 201);
  assert.equal(sent.status, 'SENT');
  const after = await thread(s.conv);
  assert.equal(after.status, 'ASSIGNED');
  assert.equal(after.assignedTo.id, c.reception.id);
  assert.equal(after.unreadCount, 0);
  // A conversa estava atribuída a quem enviou o primeiro modelo: é essa pessoa que recebe o aviso.
  const notif = ok(await call('GET', '/notifications', { token: c.reception.token }));
  assert.ok(notif.items.some((n: any) => n.type === 'NEW_MESSAGE'), 'atendente da conversa foi avisada');
});

test('fisioterapeuta só vê conversas dos seus pacientes', async () => {
  ok(await call('GET', `/conversations/${s.conv}`, { token: c.physioA.token }));
  assert.equal((await call('GET', `/conversations/${s.conv}`, { token: c.physioB.token })).status, 404);
  const listB = ok(await call('GET', '/conversations', { token: c.physioB.token }));
  assert.equal(listB.items.length, 0);
});

test('lembrete 24 h sai uma vez e CONFIRMAR confirma a sessão', async () => {
  s.a1 = await book(20);
  const run = ok(await call('POST', '/communication/reminders/run', { token: c.admin.token, body: {} }));
  assert.equal(run.sent, 1);
  const again = ok(await call('POST', '/communication/reminders/run', { token: c.admin.token, body: {} }));
  assert.equal(again.sent, 0, 'idempotente');
  const t = await thread(s.conv);
  const reminder = t.messages.at(-1);
  assert.equal(reminder.template.key, 'reminder_24h');
  assert.match(reminder.body, /CONFIRMAR, REAGENDAR ou CANCELAR/);
  ok(await inbound(s.e164, 'confirmar'), 201);
  const a = ok(await call('GET', `/appointments/${s.a1}`, { token: c.admin.token }));
  assert.equal(a.status, 'CONFIRMED');
  const t2 = await thread(s.conv);
  assert.match(t2.messages.at(-1).body, /Presença confirmada/);
});

test('CANCELAR cancela e avisa o profissional', async () => {
  // Lembrete de 2 h da sessão das próximas horas.
  s.a2 = await book(1.5);
  ok(await call('POST', '/communication/reminders/run', { token: c.admin.token, body: {} }));
  ok(await inbound(s.e164, 'Cancelar, por favor'), 201);
  const a = ok(await call('GET', `/appointments/${s.a2}`, { token: c.admin.token }));
  assert.equal(a.status, 'CANCELLED');
  const n = ok(await call('GET', '/notifications?unread=1', { token: c.physioA.token }));
  assert.ok(n.items.some((x: any) => /cancelou/.test(x.title)));
});

test('REAGENDAR vira tarefa para a recepção', async () => {
  const r = ok(await inbound(s.e164, 'REAGENDAR'), 201);
  assert.equal(r.handled, 'reschedule');
  const n = ok(await call('GET', '/notifications?unread=1', { token: c.reception.token }));
  assert.ok(n.items.some((x: any) => /remarcar/.test(x.title)));
  const d = ok(await call('GET', '/dashboard', { token: c.reception.token }));
  assert.ok(d.counts.tasks >= 1);
});

test('robô de primeiro contato cria o lead', async () => {
  const phone = `5521 9${rnd()}`;
  const r1 = ok(await inbound(phone, 'Oi, vocês atendem pelo convênio?'), 201);
  let t = await thread(r1.conversationId);
  assert.equal(t.status, 'BOT');
  assert.match(t.messages.at(-1).body, /qual é o seu nome completo/);
  ok(await inbound(phone, 'Maria Souza'), 201);
  t = await thread(r1.conversationId);
  assert.match(t.messages.at(-1).body, /Obrigado, Maria/);
  ok(await inbound(phone, 'Dor no ombro direito há 2 meses'), 201);
  ok(await inbound(phone, 'tarde'), 201);
  t = await thread(r1.conversationId);
  assert.equal(t.status, 'OPEN');
  assert.ok(t.lead);
  const lead = ok(await call('GET', `/leads/${t.lead.id}`, { token: c.reception.token }));
  assert.equal(lead.source, 'WHATSAPP');
  assert.equal(lead.name, 'Maria Souza');
  assert.match(lead.reason, /ombro/);
  const n = ok(await call('GET', '/notifications', { token: c.reception.token }));
  assert.ok(n.items.some((x: any) => x.type === 'NEW_LEAD'));
  // Próxima mensagem já vai para atendimento humano.
  const r5 = ok(await inbound(phone, 'Obrigada!'), 201);
  assert.equal(r5.handled, null);
});

test('SAIR revoga o consentimento e bloqueia lembretes', async () => {
  ok(await inbound(s.e164, 'SAIR'), 201);
  const pm = ok(await call('GET', `/patients/${s.p}/messages`, { token: c.reception.token }));
  assert.equal(pm.optedOut, true);
  await book(22);
  const run = ok(await call('POST', '/communication/reminders/run', { token: c.admin.token, body: {} }));
  assert.ok(run.skipped.some((x: any) => x.reason === 'opt_out'));
  ok(await inbound(s.e164, 'voltar'), 201);
  assert.equal(ok(await call('GET', `/patients/${s.p}/messages`, { token: c.reception.token })).optedOut, false);
});

test('modelos: só quem gerencia automações edita', async () => {
  const list = ok(await call('GET', '/communication/templates', { token: c.reception.token }));
  const t = list.find((x: any) => x.key === 'reminder_24h');
  assert.ok(t.variables.includes('paciente'));
  assert.equal((await call('PUT', `/communication/templates/${t.id}`, { token: c.reception.token, body: { isActive: false } })).status, 403);
  const u = ok(await call('PUT', `/communication/templates/${t.id}`, { token: c.admin.token, body: { body: 'Oi {{paciente}}, amanhã às {{hora}}!', isActive: true } }));
  assert.equal(u.body, 'Oi {{paciente}}, amanhã às {{hora}}!');
});

test('webhook público recusa em modo demonstração', async () => {
  assert.equal((await call('POST', '/webhooks/whatsapp', { body: { from: '5511999999999', text: 'x' } })).status, 403);
  assert.equal((await call('GET', '/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=x&hub.challenge=1')).status, 403);
});

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { isValidCpf, maskCep, maskCpf, maskPhone } from '@/lib/format';
import { LEAD_SOURCES, SEX_LABELS, TEMPERATURE_LABELS } from '@/lib/labels';
import { Alert, Avatar, Button, Checkbox, Field, Input, Modal, Select, Textarea } from './ui';

const UFS = 'AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' ');

export function useProfessionals() {
  return useQuery({ queryKey: ['professionals'], queryFn: () => api<{ id: string; name: string; calendarColor: string }[]>('/users/professionals'), staleTime: 60_000 });
}

export interface PatientFormValues {
  name: string;
  socialName: string;
  cpf: string;
  birthDate: string;
  sex: string;
  phone: string;
  whatsapp: string;
  email: string;
  profession: string;
  addressLine: string;
  city: string;
  state: string;
  zipCode: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  source: string;
  responsibleId: string;
  notes: string;
  photoUrl: string | null;
  healthDataConsent: boolean;
}

const emptyPatient: PatientFormValues = {
  name: '', socialName: '', cpf: '', birthDate: '', sex: 'NOT_INFORMED', phone: '', whatsapp: '', email: '', profession: '', addressLine: '', city: '',
  state: '', zipCode: '', emergencyContactName: '', emergencyContactPhone: '', source: 'OTHER', responsibleId: '', notes: '', photoUrl: null, healthDataConsent: false,
};

type PatientLike = Partial<Record<keyof PatientFormValues, unknown>> & { id?: string; cpf?: string | null; responsible?: { id: string } | null };

function validatePatient(v: PatientFormValues, isNew: boolean) {
  const e: Partial<Record<keyof PatientFormValues, string>> = {};
  if (v.name.trim().length < 3) e.name = 'Informe o nome completo';
  if (v.cpf && !v.cpf.includes('*') && !isValidCpf(v.cpf)) e.cpf = 'CPF inválido';
  if (v.birthDate && (v.birthDate > new Date().toISOString().slice(0, 10) || v.birthDate < '1900-01-01')) e.birthDate = 'Data inválida';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) e.email = 'E-mail inválido';
  for (const k of ['phone', 'whatsapp', 'emergencyContactPhone'] as const) if (v[k] && v[k].replace(/\D/g, '').length < 10) e[k] = 'Telefone incompleto';
  if (isNew && !v.healthDataConsent) e.healthDataConsent = 'Registre o consentimento para cadastrar dados de saúde';
  return e;
}

/** Cadastro e edição de paciente. `initial` com id = edição. */
export function PatientFormModal({ initial, onClose, onSaved }: { initial?: PatientLike; onClose: () => void; onSaved?: (id: string) => void }) {
  const qc = useQueryClient();
  const isNew = !initial?.id;
  const [v, setV] = useState<PatientFormValues>(() => {
    const base = { ...emptyPatient };
    if (initial) {
      for (const k of Object.keys(base) as (keyof PatientFormValues)[]) {
        const val = initial[k];
        if (val !== undefined && val !== null) (base as Record<string, unknown>)[k] = val;
      }
      base.responsibleId = initial.responsible?.id ?? '';
    }
    return base;
  });
  const [submitted, setSubmitted] = useState(false);
  const pros = useProfessionals();
  const fileRef = useRef<HTMLInputElement>(null);
  const set = <K extends keyof PatientFormValues>(k: K, val: PatientFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const errors = validatePatient(v, isNew);
  const err = (k: keyof PatientFormValues) => (submitted ? errors[k] : undefined);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...v };
      if (!isNew) delete body.healthDataConsent;
      // CPF mascarado vindo do servidor não é reenviado.
      if (typeof body.cpf === 'string' && (body.cpf as string).includes('*')) delete body.cpf;
      if (!isNew && initial?.cpf && v.cpf === initial.cpf) delete body.cpf;
      if (!body.responsibleId) body.responsibleId = null;
      return isNew ? api<{ id: string }>('/patients', { method: 'POST', body }) : api<{ id: string }>(`/patients/${initial!.id}`, { method: 'PATCH', body });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['patients'] });
      qc.invalidateQueries({ queryKey: ['patient', p.id] });
      qc.invalidateQueries({ queryKey: ['crm-board'] });
      toast.success(isNew ? 'Paciente cadastrado' : 'Cadastro atualizado');
      onSaved?.(p.id);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  function pickPhoto(file?: File) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) return toast.error('Use uma imagem PNG, JPG ou WebP');
    // Reduz a foto para 256px antes de enviar.
    const img = new Image();
    img.onload = () => {
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      set('photoUrl', canvas.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.src = URL.createObjectURL(file);
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={isNew ? 'Novo paciente' : 'Editar cadastro'}
      description={isNew ? 'Somente o nome é obrigatório. Os demais dados podem ser completados depois.' : undefined}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            loading={save.isPending}
            onClick={() => {
              setSubmitted(true);
              if (!Object.keys(errors).length) save.mutate();
              else toast.error('Revise os campos destacados');
            }}
          >
            {isNew ? 'Cadastrar paciente' : 'Salvar alterações'}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button type="button" onClick={() => fileRef.current?.click()} className="group relative" aria-label="Alterar foto">
            <Avatar name={v.name || '?'} src={v.photoUrl} size="lg" />
            <span className="absolute inset-0 flex items-center justify-center rounded-full bg-slate-900/40 text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-5" />
            </span>
          </button>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => pickPhoto(e.target.files?.[0])} />
          <div className="text-sm">
            <p className="font-medium text-slate-800">Foto do paciente</p>
            <p className="text-slate-500">Opcional. {v.photoUrl && <button type="button" className="text-red-600 hover:underline" onClick={() => set('photoUrl', null)}>Remover</button>}</p>
          </div>
        </div>

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome completo" required error={err('name')} className="sm:col-span-2">
            <Input autoFocus value={v.name} onChange={(e) => set('name', e.target.value)} invalid={!!err('name')} />
          </Field>
          <Field label="Nome social">
            <Input value={v.socialName} onChange={(e) => set('socialName', e.target.value)} />
          </Field>
          <Field label="CPF" error={err('cpf')} hint="Armazenado de forma criptografada.">
            <Input inputMode="numeric" value={v.cpf} placeholder="000.000.000-00" onFocus={() => v.cpf.includes('*') && set('cpf', '')} onChange={(e) => set('cpf', maskCpf(e.target.value))} invalid={!!err('cpf')} />
          </Field>
          <Field label="Data de nascimento" error={err('birthDate')}>
            <Input type="date" value={v.birthDate} onChange={(e) => set('birthDate', e.target.value)} invalid={!!err('birthDate')} />
          </Field>
          <Field label="Sexo">
            <Select value={v.sex} onChange={(e) => set('sex', e.target.value)}>
              {Object.entries(SEX_LABELS).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Telefone" error={err('phone')}>
            <Input inputMode="tel" value={v.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} invalid={!!err('phone')} />
          </Field>
          <Field label="WhatsApp" error={err('whatsapp')}>
            <Input inputMode="tel" value={v.whatsapp} onChange={(e) => set('whatsapp', maskPhone(e.target.value))} invalid={!!err('whatsapp')} />
          </Field>
          <Field label="E-mail" error={err('email')}>
            <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} invalid={!!err('email')} />
          </Field>
          <Field label="Profissão">
            <Input value={v.profession} onChange={(e) => set('profession', e.target.value)} />
          </Field>
          <Field label="Como conheceu a clínica">
            <Select value={v.source} onChange={(e) => set('source', e.target.value)}>
              {Object.entries(LEAD_SOURCES).map(([k, l]) => (
                <option key={k} value={k}>{l}</option>
              ))}
            </Select>
          </Field>
          <Field label="Fisioterapeuta responsável">
            <Select value={v.responsibleId} onChange={(e) => set('responsibleId', e.target.value)}>
              <option value="">— Sem responsável —</option>
              {pros.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
          </Field>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Endereço</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Endereço" className="sm:col-span-2">
              <Input value={v.addressLine} onChange={(e) => set('addressLine', e.target.value)} />
            </Field>
            <Field label="Cidade">
              <Input value={v.city} onChange={(e) => set('city', e.target.value)} />
            </Field>
            <div className="grid grid-cols-[80px_1fr] gap-2">
              <Field label="UF">
                <Select value={v.state} onChange={(e) => set('state', e.target.value)}>
                  <option value="">—</option>
                  {UFS.map((u) => <option key={u}>{u}</option>)}
                </Select>
              </Field>
              <Field label="CEP">
                <Input inputMode="numeric" value={v.zipCode} onChange={(e) => set('zipCode', maskCep(e.target.value))} />
              </Field>
            </div>
          </div>
        </section>

        <section>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Contato de emergência</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome">
              <Input value={v.emergencyContactName} onChange={(e) => set('emergencyContactName', e.target.value)} />
            </Field>
            <Field label="Telefone" error={err('emergencyContactPhone')}>
              <Input inputMode="tel" value={v.emergencyContactPhone} onChange={(e) => set('emergencyContactPhone', maskPhone(e.target.value))} />
            </Field>
          </div>
        </section>

        <Field label="Observações administrativas" hint="Informações clínicas vão no prontuário, não aqui.">
          <Textarea value={v.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
        </Field>

        {isNew && (
          <div className="rounded-xl border border-slate-200 p-4">
            <Checkbox
              checked={v.healthDataConsent}
              onChange={(b) => set('healthDataConsent', b)}
              label="O paciente autorizou o tratamento dos seus dados de saúde"
              description="Consentimento exigido pela LGPD para registrar prontuário, avaliações e evoluções. Fica registrado com data e responsável."
            />
            {err('healthDataConsent') && <p className="mt-2 text-xs font-medium text-red-600">{err('healthDataConsent')}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ───────────────────────── Lead ─────────────────────────

export interface LeadFormValues {
  id?: string;
  name: string;
  phone: string;
  email: string;
  source: string;
  sourceDetail: string;
  temperature: string;
  reason: string;
  bodyRegion: string;
  hasDiagnosis: '' | 'yes' | 'no';
  previousPhysio: '' | 'yes' | 'no';
  responsibleId: string;
}

export function LeadFormModal({ initial, onClose }: { initial?: Partial<LeadFormValues> & { responsible?: { id: string } | null; hasDiagnosis?: unknown; previousPhysio?: unknown }; onClose: () => void }) {
  const qc = useQueryClient();
  const pros = useProfessionals();
  const yn = (b: unknown): '' | 'yes' | 'no' => (b === true ? 'yes' : b === false ? 'no' : '');
  const [v, setV] = useState<LeadFormValues>({
    id: initial?.id,
    name: initial?.name ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    source: initial?.source ?? 'WHATSAPP',
    sourceDetail: initial?.sourceDetail ?? '',
    temperature: initial?.temperature ?? '',
    reason: initial?.reason ?? '',
    bodyRegion: initial?.bodyRegion ?? '',
    hasDiagnosis: yn(initial?.hasDiagnosis),
    previousPhysio: yn(initial?.previousPhysio),
    responsibleId: initial?.responsible?.id ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const set = <K extends keyof LeadFormValues>(k: K, val: LeadFormValues[K]) => setV((s) => ({ ...s, [k]: val }));
  const errors: Partial<Record<keyof LeadFormValues, string>> = {};
  if (v.name.trim().length < 2) errors.name = 'Informe o nome';
  if (v.phone.replace(/\D/g, '').length < 10) errors.phone = 'Telefone incompleto';
  if (v.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.email)) errors.email = 'E-mail inválido';

  const save = useMutation({
    mutationFn: () => {
      const tri = (x: string) => (x === 'yes' ? true : x === 'no' ? false : undefined);
      const body = {
        name: v.name, phone: v.phone, email: v.email, source: v.source, sourceDetail: v.sourceDetail, temperature: v.temperature, reason: v.reason,
        bodyRegion: v.bodyRegion, hasDiagnosis: tri(v.hasDiagnosis), previousPhysio: tri(v.previousPhysio), responsibleId: v.responsibleId || null,
      };
      return v.id ? api(`/leads/${v.id}`, { method: 'PATCH', body }) : api('/leads', { method: 'POST', body });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['crm-board'] });
      toast.success(v.id ? 'Lead atualizado' : 'Lead cadastrado');
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });

  const show = (k: keyof LeadFormValues) => (submitted ? errors[k] : undefined);
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={v.id ? 'Editar lead' : 'Novo contato'}
      description="Pessoa interessada que ainda não é paciente."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button loading={save.isPending} onClick={() => { setSubmitted(true); if (!Object.keys(errors).length) save.mutate(); }}>
            {v.id ? 'Salvar' : 'Cadastrar lead'}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Nome" required error={show('name')} className="sm:col-span-2">
          <Input autoFocus value={v.name} onChange={(e) => set('name', e.target.value)} invalid={!!show('name')} />
        </Field>
        <Field label="Telefone / WhatsApp" required error={show('phone')}>
          <Input inputMode="tel" value={v.phone} onChange={(e) => set('phone', maskPhone(e.target.value))} invalid={!!show('phone')} />
        </Field>
        <Field label="E-mail" error={show('email')}>
          <Input type="email" value={v.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field label="Origem">
          <Select value={v.source} onChange={(e) => set('source', e.target.value)}>
            {Object.entries(LEAD_SOURCES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Detalhe da origem" hint="Ex.: nome de quem indicou, campanha.">
          <Input value={v.sourceDetail} onChange={(e) => set('sourceDetail', e.target.value)} />
        </Field>
        <Field label="Motivo do contato" className="sm:col-span-2">
          <Input placeholder="Ex.: dor no ombro há 2 meses" value={v.reason} onChange={(e) => set('reason', e.target.value)} />
        </Field>
        <Field label="Região com dor ou lesão">
          <Input value={v.bodyRegion} onChange={(e) => set('bodyRegion', e.target.value)} />
        </Field>
        <Field label="Classificação">
          <Select value={v.temperature} onChange={(e) => set('temperature', e.target.value)}>
            <option value="">—</option>
            {Object.entries(TEMPERATURE_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Possui diagnóstico?">
          <Select value={v.hasDiagnosis} onChange={(e) => set('hasDiagnosis', e.target.value as LeadFormValues['hasDiagnosis'])}>
            <option value="">Não informado</option><option value="yes">Sim</option><option value="no">Não</option>
          </Select>
        </Field>
        <Field label="Já fez fisioterapia?">
          <Select value={v.previousPhysio} onChange={(e) => set('previousPhysio', e.target.value as LeadFormValues['previousPhysio'])}>
            <option value="">Não informado</option><option value="yes">Sim</option><option value="no">Não</option>
          </Select>
        </Field>
        <Field label="Responsável" className="sm:col-span-2">
          <Select value={v.responsibleId} onChange={(e) => set('responsibleId', e.target.value)}>
            <option value="">Eu mesmo</option>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

export function ConvertLeadModal({ lead, onClose, onDone }: { lead: { id: string; name: string; responsible?: { id: string } | null }; onClose: () => void; onDone: (patientId: string) => void }) {
  const qc = useQueryClient();
  const pros = useProfessionals();
  const [cpf, setCpf] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [sex, setSex] = useState('NOT_INFORMED');
  const [responsibleId, setResponsibleId] = useState(lead.responsible?.id ?? '');
  const [consent, setConsent] = useState(false);
  const cpfInvalid = !!cpf && !isValidCpf(cpf);
  const save = useMutation({
    mutationFn: () => api<{ patientId: string; code: string }>(`/leads/${lead.id}/convert`, { method: 'POST', body: { cpf: cpf || null, birthDate: birthDate || null, sex, responsibleId: responsibleId || null, healthDataConsent: consent } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['crm-board'] });
      qc.invalidateQueries({ queryKey: ['patients'] });
      toast.success(`${lead.name} agora é paciente (${r.code})`);
      onDone(r.patientId);
    },
    onError: (e) => toast.error(e.message),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title="Converter em paciente"
      description={`${lead.name} passa para a etapa "Tratamento iniciado". Os dados do primeiro contato viram o ponto de partida do prontuário.`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button loading={save.isPending} disabled={!consent || cpfInvalid} onClick={() => save.mutate()}>Converter</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="CPF" error={cpfInvalid ? 'CPF inválido' : undefined}>
          <Input inputMode="numeric" placeholder="000.000.000-00" value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} invalid={cpfInvalid} />
        </Field>
        <Field label="Data de nascimento">
          <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </Field>
        <Field label="Sexo">
          <Select value={sex} onChange={(e) => setSex(e.target.value)}>
            {Object.entries(SEX_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </Select>
        </Field>
        <Field label="Fisioterapeuta responsável">
          <Select value={responsibleId} onChange={(e) => setResponsibleId(e.target.value)}>
            <option value="">— Sem responsável —</option>
            {pros.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Alert tone="brand" icon={<ShieldCheck className="size-4" />}>
            <Checkbox checked={consent} onChange={setConsent} label="O paciente autorizou o tratamento dos seus dados de saúde (LGPD)" />
          </Alert>
        </div>
      </div>
    </Modal>
  );
}

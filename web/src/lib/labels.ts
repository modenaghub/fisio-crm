import type { BadgeTone } from '@/components/ui';

export const LEAD_SOURCES: Record<string, string> = {
  WHATSAPP: 'WhatsApp',
  INSTAGRAM: 'Instagram',
  GOOGLE: 'Google',
  REFERRAL: 'Indicação de paciente',
  DOCTOR_REFERRAL: 'Indicação médica',
  WEBSITE: 'Site',
  WALK_IN: 'Presencial',
  PHONE: 'Telefone',
  OTHER: 'Outro',
};

export const STAGE_LABELS: Record<string, string> = {
  NEW_CONTACT: 'Novo contato',
  FIRST_SERVICE: 'Primeiro atendimento',
  DATA_COLLECTED: 'Dados coletados',
  EVALUATION_SCHEDULED: 'Avaliação agendada',
  EVALUATION_DONE: 'Avaliação realizada',
  CONVERTED: 'Convertido',
  LOST: 'Perdido',
  TREATMENT_STARTED: 'Tratamento iniciado',
  ACTIVE: 'Paciente ativo',
  IN_TREATMENT: 'Em tratamento',
  DISCHARGED: 'Alta',
  INACTIVE: 'Inativo',
  REACTIVATION: 'Reativação',
};

export const PATIENT_STAGES = ['TREATMENT_STARTED', 'ACTIVE', 'IN_TREATMENT', 'DISCHARGED', 'INACTIVE', 'REACTIVATION'];
export const LEAD_STAGES = ['NEW_CONTACT', 'FIRST_SERVICE', 'DATA_COLLECTED', 'EVALUATION_SCHEDULED', 'EVALUATION_DONE'];

export const STAGE_TONES: Record<string, BadgeTone> = {
  NEW_CONTACT: 'blue',
  FIRST_SERVICE: 'blue',
  DATA_COLLECTED: 'blue',
  EVALUATION_SCHEDULED: 'violet',
  EVALUATION_DONE: 'violet',
  TREATMENT_STARTED: 'brand',
  ACTIVE: 'green',
  IN_TREATMENT: 'green',
  DISCHARGED: 'slate',
  INACTIVE: 'amber',
  REACTIVATION: 'amber',
  LOST: 'red',
};

/** Cor da faixa superior de cada coluna do Kanban. */
export const STAGE_COLORS: Record<string, string> = {
  NEW_CONTACT: '#60a5fa',
  FIRST_SERVICE: '#3b82f6',
  DATA_COLLECTED: '#2563eb',
  EVALUATION_SCHEDULED: '#8b5cf6',
  EVALUATION_DONE: '#7c3aed',
  TREATMENT_STARTED: '#2a978a',
  ACTIVE: '#10b981',
  IN_TREATMENT: '#059669',
  DISCHARGED: '#64748b',
  INACTIVE: '#f59e0b',
  REACTIVATION: '#ea580c',
};

export const SEX_LABELS: Record<string, string> = { FEMALE: 'Feminino', MALE: 'Masculino', OTHER: 'Outro', NOT_INFORMED: 'Não informado' };

export const TEMPERATURE_LABELS: Record<string, string> = { HOT: 'Quente', WARM: 'Morno', COLD: 'Frio' };

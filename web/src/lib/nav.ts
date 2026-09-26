import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  FileHeart,
  KanbanSquare,
  LayoutDashboard,
  ListChecks,
  MessageCircle,
  Settings,
  Stethoscope,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  permission?: string;
  /** Fase em que o módulo é entregue (ausente = já disponível). */
  phase?: number;
  summary?: string;
  features?: string[];
}

export const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, permission: 'dashboard.view' },
  {
    to: '/crm', label: 'CRM', icon: KanbanSquare, permission: 'leads.read', phase: 3,
    summary: 'Funil visual de leads e pacientes, do primeiro contato à reativação.',
    features: ['Kanban com as 11 etapas do funil', 'Card com contato, origem, próxima consulta, sessões e responsável', 'Conversão de lead em paciente', 'Classificação e origem dos leads'],
  },
  {
    to: '/pacientes', label: 'Pacientes', icon: Users, permission: 'patients.read', phase: 3,
    summary: 'Ficha completa de cada paciente, com dados pessoais, linha do tempo e busca global.',
    features: ['Cadastro com CPF cifrado e validado', 'Abas: dados, avaliação, tratamento, evoluções, agenda, financeiro, comunicação, documentos', 'Linha do tempo de todos os acontecimentos', 'Busca por nome, CPF, telefone, e-mail ou código'],
  },
  {
    to: '/agenda', label: 'Agenda', icon: CalendarDays, permission: 'schedule.read', phase: 5,
    summary: 'Agenda por dia, semana e mês, adaptada ao celular.',
    features: ['Arrastar e soltar, bloqueios e intervalos', 'Agendamento recorrente (ex.: terças e quintas às 15h por 3 meses)', 'Status: agendado, confirmado, realizado, faltou, cancelado, reagendado', 'Taxa de ocupação por profissional'],
  },
  {
    to: '/atendimentos', label: 'Atendimentos', icon: Stethoscope, permission: 'clinical.write', phase: 4,
    summary: 'Registro da sessão com evolução, procedimentos e orientações.',
    features: ['Campo livre "Evolução / Observações do atendimento"', 'Numeração automática da sessão e desconto do pacote', 'Histórico permanente com versões — nada é apagado sem administrador', 'Auditoria de toda alteração'],
  },
  {
    to: '/prontuarios', label: 'Prontuários', icon: FileHeart, permission: 'clinical.read', phase: 4,
    summary: 'Dados clínicos, avaliações, plano de tratamento e evoluções.',
    features: ['Avaliação inicial e reavaliações (dor, ADM, força, testes e escalas)', 'Plano de tratamento com objetivo, frequência e previsão de término', 'Registro de quem acessou cada prontuário'],
  },
  {
    to: '/comunicacao', label: 'Comunicação', icon: MessageCircle, permission: 'messages.read', phase: 7,
    summary: 'Central de mensagens com WhatsApp oficial, e-mail e SMS.',
    features: ['Bot de primeiro contato que cria o lead automaticamente', 'Lembretes 24 h e 2 h antes com botões Confirmar / Reagendar / Cancelar', 'Mensagens após falta, após atendimento e para pacientes sem retorno', 'Atendimento manual pelo fisioterapeuta'],
  },
  {
    to: '/financeiro', label: 'Financeiro', icon: Wallet, permission: 'finance.read', phase: 6,
    summary: 'Receitas, despesas, pacotes de sessões e projeção de faturamento.',
    features: ['Contas a receber com PIX, dinheiro, cartão e transferência', 'Pacotes com sessões restantes calculadas automaticamente', 'Painel "Quanto vou faturar?" — hoje, semana, mês, 3, 6 e 12 meses', 'Metas de faturamento, sessões e novos pacientes'],
  },
  {
    to: '/relatorios', label: 'Relatórios', icon: BarChart3, permission: 'reports.view', phase: 9,
    summary: 'Relatórios filtráveis com exportação em PDF e Excel/CSV.',
    features: ['Pacientes, atendimentos, faturamento, despesas, faltas e cancelamentos', 'Origem dos pacientes e taxa de conversão', 'Filtros por data, profissional, tratamento, status e forma de pagamento'],
  },
  {
    to: '/tarefas', label: 'Tarefas', icon: ListChecks, permission: 'tasks.manage', phase: 8,
    summary: 'Tarefas da equipe e motor de automações.',
    features: ['Responsável, prazo, prioridade e status', 'Automações SE/ENTÃO (ex.: paciente faltou → criar tarefa de contato)', 'Central de notificações'],
  },
  { to: '/configuracoes', label: 'Configurações', icon: Settings },
];

export const ROADMAP_ICON = ClipboardList;

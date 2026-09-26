/**
 * Contrato de IA assistiva — Fase 11.
 * Escopo permitido: resumir histórico, organizar evoluções, sugerir estrutura de anotação,
 * apontar informações faltantes, classificar leads, prever abandono e demanda, analisar faturamento.
 * A IA NUNCA produz diagnóstico nem substitui a avaliação do fisioterapeuta; toda saída é
 * marcada como sugestão e exige revisão humana. Dados enviados ao provedor devem ser minimizados.
 * INTEGRAÇÃO REAL: Claude API (ANTHROPIC_API_KEY).
 */
export type AiTask =
  | 'summarize_patient_history'
  | 'summarize_session'
  | 'suggest_note_structure'
  | 'find_missing_information'
  | 'classify_lead'
  | 'predict_dropout'
  | 'analyze_revenue';

export interface AiProvider {
  readonly mode: 'mock' | 'real';
  run(task: AiTask, input: Record<string, unknown>): Promise<{ text: string; isSuggestion: true }>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export class MockAiProvider implements AiProvider {
  readonly mode = 'mock' as const;
  async run(task: AiTask) {
    return { text: `[Demonstração] Resultado simulado para "${task}". Nenhum modelo foi consultado.`, isSuggestion: true as const };
  }
}

import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellOff, MessageCircle } from 'lucide-react';
import type { PatientDetail } from '../PatientPage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { Alert, Badge, Card, CardHeader, EmptyState, ErrorState, LoadingState } from '@/components/ui';
import { Composer, CONVERSATION_STATUS, MessageThread, type ConversationDetail } from '@/components/messaging';

interface PatientMessages {
  phone: string | null;
  optedOut: boolean;
  conversation: ConversationDetail | null;
}

export default function MessagesTab({ patient }: { patient: PatientDetail }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['patient-messages', patient.id], queryFn: () => api<PatientMessages>(`/patients/${patient.id}/messages`), refetchInterval: 15_000 });
  const send = useMutation({
    mutationFn: (p: { body?: string; templateKey?: string }) => api(`/patients/${patient.id}/messages`, { method: 'POST', body: p }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['patient-messages', patient.id] }); qc.invalidateQueries({ queryKey: ['conversations'] }); },
    onError: (e) => toast.error(e.message),
  });
  if (q.isLoading) return <Card><LoadingState rows={4} /></Card>;
  if (q.isError || !q.data) return <Card><ErrorState message={q.error?.message} onRetry={() => q.refetch()} /></Card>;
  const { conversation: c, phone, optedOut } = q.data;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="WhatsApp"
        description={phone ? `Conversa com ${patient.name.split(' ')[0]}` : undefined}
        actions={c && (
          <div className="flex items-center gap-2">
            <Badge tone={CONVERSATION_STATUS[c.status].tone}>{CONVERSATION_STATUS[c.status].label}</Badge>
            <Link to={`/comunicacao?c=${c.id}`} className="text-sm font-medium text-brand-700 hover:underline">Abrir em Comunicação</Link>
          </div>
        )}
      />
      {optedOut && (
        <div className="px-5 pb-3">
          <Alert tone="amber" icon={<BellOff className="size-4" />} title="Paciente pediu para não receber mensagens automáticas">
            Lembretes e avisos automáticos estão suspensos. Mensagens da equipe continuam possíveis quando ele escrever.
          </Alert>
        </div>
      )}
      {!phone ? (
        <EmptyState icon={<MessageCircle className="size-6" />} title="Sem WhatsApp cadastrado" description="Cadastre o WhatsApp ou telefone na aba Dados para conversar e enviar lembretes." />
      ) : (
        <>
          <MessageThread messages={c?.messages ?? []} className="h-[26rem]" />
          <Composer
            windowOpen={!!c?.windowOpen}
            windowEndsAt={c?.serviceWindowEndsAt ?? null}
            sending={send.isPending}
            onSend={(p) => send.mutateAsync(p)}
            disabledReason={can('messages.send') ? null : 'Você pode ler, mas não enviar mensagens.'}
          />
        </>
      )}
    </Card>
  );
}

import type { PatientDetail } from '../PatientPage';
import { Card, EmptyState } from '@/components/ui';

export default function ScheduleTab({ patient }: { patient: PatientDetail }) {
  void patient;
  return (
    <Card>
      <EmptyState title="Em construção" description="Esta aba chega com a Fase 5." />
    </Card>
  );
}

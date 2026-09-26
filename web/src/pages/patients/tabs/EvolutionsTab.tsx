import type { PatientDetail } from '../PatientPage';
import { Card, EmptyState } from '@/components/ui';

export default function EvolutionsTab({ patient }: { patient: PatientDetail }) {
  void patient;
  return (
    <Card>
      <EmptyState title="Em construção" description="Esta aba chega com a Fase 4." />
    </Card>
  );
}

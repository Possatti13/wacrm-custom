import { ReportsView } from "@/components/reports/reports-view";

export const metadata = {
  title: "Relatórios & Indicadores | Ciclopes",
  description: "Métricas de atendimento, conversão de pipeline e indicadores comerciais.",
};

export default function ReportsPage() {
  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
      <ReportsView />
    </div>
  );
}

import { IntelligenceCenterView } from "@/components/intelligence/intelligence-center-view";

export const metadata = {
  title: "Central de Inteligência Comercial | Ciclopes",
  description: "Sinais de compra, propensão de leads, objeções e sugestões de avanço de pipeline.",
};

export default function IntelligencePage() {
  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
      <IntelligenceCenterView />
    </div>
  );
}

import { CatalogView } from "@/components/catalog/catalog-view";

export const metadata = {
  title: "Catálogo de Produtos & Serviços | Ciclopes",
  description: "Gerenciamento de produtos, serviços e termos de busca para inteligência comercial.",
};

export default function CatalogPage() {
  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
      <CatalogView />
    </div>
  );
}

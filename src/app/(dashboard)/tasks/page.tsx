import { TasksView } from "@/components/tasks/tasks-view";

export const metadata = {
  title: "Tarefas & Follow-up | Ziron CRM",
  description: "Gerenciamento de tarefas, follow-ups e recomendações comerciais inteligentes.",
};

export default function TasksPage() {
  return (
    <div className="container mx-auto p-4 sm:p-6 max-w-7xl">
      <TasksView />
    </div>
  );
}

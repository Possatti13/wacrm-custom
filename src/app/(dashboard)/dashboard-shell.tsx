"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/hooks/use-auth";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PresenceHeartbeat } from "@/components/presence/presence-heartbeat";
import { CiclopesSymbol } from "@/components/brand/ciclopes-symbol";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { LogOut, ShieldAlert } from "lucide-react";

import { MobileBottomNav } from "@/components/layout/mobile-bottom-nav";

// Auth-gated dashboard shell. Extracted from the layout so the layout
// itself can stay a server component and export metadata (noindex) —
// client components can't export Next's metadata object.

function DashboardShellInner({ children }: { children: React.ReactNode }) {
  const { user, profile, accountId, loading, profileLoading } = useAuth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  // Sidebar drawer state — only used on mobile. On lg+ the sidebar is
  // always visible and this stays at `false` (ignored by the component).
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  const handleSignOut = async () => {
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (loading || profileLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          <p className="text-sm text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // INERT USER GATE: User is authenticated in Supabase Auth,
  // but possesses no membership / account link in Ciclopes.
  if (!accountId || !profile?.account_id) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#F7F3EC] p-4 text-[#1E3A5F] dark:bg-background dark:text-foreground">
        <div className="w-full max-w-md rounded-2xl border border-[#D9CBB8] bg-white/95 p-8 shadow-xl backdrop-blur dark:border-border dark:bg-card">
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 rounded-2xl bg-[#F7F3EC] p-4 ring-1 ring-[#D9CBB8] dark:bg-muted dark:ring-border">
              <CiclopesSymbol size={48} variant="aegean" />
            </div>

            <div className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-[#D16A3A]/20 bg-[#D16A3A]/10 px-3 py-1 text-xs font-medium text-[#D16A3A]">
              <ShieldAlert className="h-3.5 w-3.5" />
              Acesso Pendente de Convite
            </div>

            <h1 className="font-serif text-2xl font-bold tracking-tight text-[#1E3A5F] dark:text-foreground">
              Acesso Não Vinculado
            </h1>

            <p className="mt-1 text-xs uppercase tracking-widest text-[#D16A3A]">
              Muitas conversas. Uma visão.
            </p>

            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Sua identidade foi autenticada, mas seu usuário ainda não possui
              vínculo ativo com nenhuma organização no Ciclopes.
            </p>

            <div className="mt-6 w-full rounded-xl border border-[#D9CBB8]/60 bg-[#F7F3EC]/50 p-4 text-left text-xs text-muted-foreground dark:border-border/60 dark:bg-muted/40">
              <p className="font-semibold text-[#1E3A5F] dark:text-foreground">
                Como obter acesso:
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Abra o link de convite oficial enviado pelo seu administrador.</li>
                <li>Ou solicite ao responsável pela sua empresa o provisionamento de acesso.</li>
              </ul>
            </div>

            <Button
              variant="outline"
              onClick={handleSignOut}
              disabled={loggingOut}
              className="mt-6 w-full border-[#D9CBB8] text-[#1E3A5F] hover:bg-[#F7F3EC] dark:border-border dark:text-foreground"
            >
              <LogOut className="mr-2 h-4 w-4" />
              {loggingOut ? "Saindo..." : "Sair da Conta"}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden bg-background">
      {/* Reports this tab's online/away presence once we know a user is
          signed in. Headless — renders nothing. */}
      <PresenceHeartbeat />
      <Sidebar open={sidebarOpen} onClose={closeSidebar} />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Header onOpenSidebar={() => setSidebarOpen(true)} />
        {/* Responsive padding and scroll container */}
        <main className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-6 pb-20 lg:pb-6">{children}</main>
        <MobileBottomNav />
      </div>
    </div>
  );
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardShellInner>{children}</DashboardShellInner>
    </AuthProvider>
  );
}

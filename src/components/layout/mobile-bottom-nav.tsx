"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  MessageSquare,
  ListTodo,
  GitBranch,
  LayoutDashboard,
  Menu,
  Users,
  Package,
  Settings,
  Bell,
  LogOut,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CiclopesLogo } from "@/components/brand/ciclopes-logo";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export function MobileBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { profile, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();
  const [moreDrawerOpen, setMoreDrawerOpen] = useState(false);

  const activeConvId = searchParams.get("c");
  const isViewingConversation = pathname === "/inbox" && Boolean(activeConvId);

  // If mobile is actively viewing a conversation thread, hide bottom nav
  // so the composer sits directly above keyboard / home bar with zero wasted space
  if (isViewingConversation) {
    return null;
  }

  const isManager = accountRole === "owner" || accountRole === "admin";

  const primaryTabs = [
    {
      href: "/inbox",
      label: "Conversas",
      icon: MessageSquare,
      badge: totalUnread > 0 ? totalUnread : undefined,
    },
    {
      href: "/tasks",
      label: "Tarefas",
      icon: ListTodo,
    },
    {
      href: "/pipelines",
      label: "Pipeline",
      icon: GitBranch,
    },
    {
      href: "/dashboard",
      label: "Cockpit",
      icon: LayoutDashboard,
    },
  ];

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <>
      <nav
        aria-label="Mobile Navigation"
        className="fixed bottom-0 left-0 right-0 z-30 flex h-16 items-center justify-around border-t border-border bg-card/95 px-2 backdrop-blur-md pb-safe lg:hidden"
      >
        {primaryTabs.map((tab) => {
          const isActive = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;

          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "relative flex min-h-[44px] min-w-[48px] flex-1 flex-col items-center justify-center gap-1 py-1 text-center transition-colors",
                isActive
                  ? "text-primary font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <div className="relative">
                <Icon className={cn("size-5 transition-transform", isActive && "scale-110 text-[#D16A3A]")} />
                {tab.badge ? (
                  <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D16A3A] px-1 text-[10px] font-bold text-white shadow-xs">
                    {tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                ) : null}
              </div>
              <span className="text-[10px] tracking-tight">{tab.label}</span>
            </Link>
          );
        })}

        {/* More Button */}
        <button
          type="button"
          onClick={() => setMoreDrawerOpen(true)}
          className={cn(
            "relative flex min-h-[44px] min-w-[48px] flex-1 flex-col items-center justify-center gap-1 py-1 text-center text-muted-foreground hover:text-foreground transition-colors",
            moreDrawerOpen && "text-primary"
          )}
        >
          <div className="relative">
            <Menu className="size-5" />
            {unreadNotifications > 0 && (
              <span className="absolute -right-1 -top-1 flex size-2 rounded-full bg-[#D16A3A]" />
            )}
          </div>
          <span className="text-[10px] tracking-tight">Mais</span>
        </button>
      </nav>

      {/* More Navigation Sheet for Mobile */}
      <Sheet open={moreDrawerOpen} onOpenChange={setMoreDrawerOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl border-t border-border bg-card p-0 text-foreground max-h-[85vh] flex flex-col"
        >
          <div className="flex items-center justify-between border-b border-border/60 p-4">
            <div className="flex items-center gap-2">
              <CiclopesLogo size="sm" variant="aegean" showTagline={false} />
            </div>
            <button
              type="button"
              onClick={() => setMoreDrawerOpen(false)}
              className="flex size-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted"
            >
              <X className="size-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* User card */}
            <div className="flex items-center gap-3 rounded-xl border border-border/70 bg-muted/40 p-3">
              <Avatar className="size-10 border border-border">
                {profile?.avatar_url ? (
                  <AvatarImage src={profile.avatar_url} alt={profile.full_name || "User"} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                  {initial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-bold text-foreground">
                  {profile?.full_name || "Usuário"}
                </p>
                <p className="truncate text-[11px] text-muted-foreground">
                  {profile?.email}
                </p>
              </div>
            </div>

            {/* Links section */}
            <div className="space-y-1">
              <Link
                href="/contacts"
                onClick={() => setMoreDrawerOpen(false)}
                className="flex items-center gap-3 rounded-xl p-3 text-xs font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
              >
                <Users className="size-4 text-muted-foreground" />
                <span>Contatos</span>
              </Link>

              {isManager && (
                <Link
                  href="/catalog"
                  onClick={() => setMoreDrawerOpen(false)}
                  className="flex items-center gap-3 rounded-xl p-3 text-xs font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
                >
                  <Package className="size-4 text-muted-foreground" />
                  <span>Catálogo de Produtos</span>
                </Link>
              )}

              <Link
                href="/notifications"
                onClick={() => setMoreDrawerOpen(false)}
                className="flex items-center justify-between rounded-xl p-3 text-xs font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
              >
                <div className="flex items-center gap-3">
                  <Bell className="size-4 text-muted-foreground" />
                  <span>Notificações</span>
                </div>
                {unreadNotifications > 0 && (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#D16A3A] px-1.5 text-[10px] font-bold text-white">
                    {unreadNotifications}
                  </span>
                )}
              </Link>

              <Link
                href="/settings"
                onClick={() => setMoreDrawerOpen(false)}
                className="flex items-center gap-3 rounded-xl p-3 text-xs font-medium text-foreground hover:bg-muted transition-colors min-h-[44px]"
              >
                <Settings className="size-4 text-muted-foreground" />
                <span>Configurações</span>
              </Link>
            </div>

            <div className="pt-2 border-t border-border/60">
              <button
                type="button"
                onClick={() => {
                  setMoreDrawerOpen(false);
                  signOut();
                }}
                className="flex w-full items-center gap-3 rounded-xl p-3 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors min-h-[44px]"
              >
                <LogOut className="size-4" />
                <span>Sair da Conta</span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

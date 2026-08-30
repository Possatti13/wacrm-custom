"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/use-auth";
import { useTotalUnread } from "@/hooks/use-total-unread";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  Crown,
  GitBranch,
  LayoutDashboard,
  ListTodo,
  LogOut,
  MessageSquare,
  Package,
  Settings,
  Shield,
  User,
  UserCog,
  Users,
  UsersRound,
  X,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import type { AccountRole } from "@/lib/auth/roles";
import { CiclopesLogo } from "@/components/brand/ciclopes-logo";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslations } from "next-intl";

const ROLE_CHIP: Record<
  AccountRole,
  { icon: typeof Crown; labelKey: string; className: string }
> = {
  owner: {
    icon: Crown,
    labelKey: "roleOwner",
    className: "border-amber-500/40 bg-amber-500/10 text-amber-300",
  },
  admin: {
    icon: Shield,
    labelKey: "roleAdmin",
    className: "border-[#D16A3A]/40 bg-[#D16A3A]/10 text-[#D16A3A]",
  },
  agent: {
    icon: UserCog,
    labelKey: "roleAgent",
    className: "border-sidebar-border bg-sidebar-accent text-sidebar-foreground",
  },
  viewer: {
    icon: User,
    labelKey: "roleViewer",
    className: "border-sidebar-border bg-sidebar/50 text-sidebar-foreground/70",
  },
};

interface NavItem {
  href: string;
  labelKey: string;
  icon: typeof LayoutDashboard;
  beta?: boolean;
}

interface NavSection {
  titleKey?: string;
  items: NavItem[];
}

interface SidebarProps {
  /** Controlled on mobile by the Header's hamburger button. Ignored on lg+. */
  open?: boolean;
  onClose?: () => void;
}

export function Sidebar({ open = false, onClose }: SidebarProps) {
  const t = useTranslations("Sidebar");
  const pathname = usePathname();
  const { profile, profileLoading, account, accountRole, signOut } = useAuth();
  const totalUnread = useTotalUnread();
  const unreadNotifications = useUnreadNotifications();

  const isManager = accountRole === "owner" || accountRole === "admin";
  const isAgent = accountRole === "agent";

  // Build role-aware navigation structure per Section 12
  const sections: NavSection[] = useMemo(() => {
    if (isManager) {
      return [
        {
          titleKey: "sectionOperation",
          items: [
            { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
            { href: "/tasks", labelKey: "tasks", icon: ListTodo },
            { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
          ],
        },
        {
          titleKey: "sectionManagement",
          items: [
            { href: "/dashboard", labelKey: "dashboard", icon: LayoutDashboard },
          ],
        },
        {
          titleKey: "sectionBase",
          items: [
            { href: "/contacts", labelKey: "contacts", icon: Users },
            { href: "/catalog", labelKey: "catalog", icon: Package },
          ],
        },
      ];
    }

    if (isAgent) {
      return [
        {
          titleKey: "sectionOperation",
          items: [
            { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
            { href: "/tasks", labelKey: "tasks", icon: ListTodo },
            { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
          ],
        },
        {
          titleKey: "sectionBase",
          items: [
            { href: "/contacts", labelKey: "contacts", icon: Users },
          ],
        },
      ];
    }

    // Default: Viewer (Read-only Operation)
    return [
      {
        titleKey: "sectionOperation",
        items: [
          { href: "/inbox", labelKey: "inbox", icon: MessageSquare },
          { href: "/tasks", labelKey: "tasks", icon: ListTodo },
          { href: "/pipelines", labelKey: "pipelines", icon: GitBranch },
        ],
      },
    ];
  }, [isManager, isAgent]);

  const bottomNavItems: NavItem[] = useMemo(() => {
    if (isManager) {
      return [{ href: "/settings", labelKey: "settings", icon: Settings }];
    }
    return [{ href: "/settings?tab=profile", labelKey: "myAccount", icon: User }];
  }, [isManager]);

  const showAccountStrip =
    !profileLoading &&
    !!account?.name &&
    account.name !== profile?.full_name;

  useEffect(() => {
    onClose?.();
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  return (
    <>
      {/* Mobile Backdrop */}
      <button
        type="button"
        aria-label={t("closeMenu")}
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-30 bg-background/80 backdrop-blur-sm transition-opacity lg:hidden",
          open
            ? "pointer-events-auto opacity-100"
            : "pointer-events-none opacity-0",
        )}
      />

      <aside
        className={cn(
          // Mobile: fixed drawer that slides in from the left.
          "fixed inset-y-0 left-0 z-40 flex h-full w-[228px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-2xl relative overflow-hidden",
          "transition-transform duration-200 ease-out will-change-transform",
          open ? "translate-x-0" : "-translate-x-full",
          // Desktop: static, always visible
          "lg:static lg:z-0 lg:w-[228px] lg:translate-x-0 lg:transition-none lg:shadow-none",
        )}
        aria-label="Primary"
      >
        {/* Subtle Classical Greek Engraving Watermark in Background */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 w-36 h-48 opacity-[0.06] bg-no-repeat bg-contain bg-bottom"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 140' fill='%23FFFFFF'%3E%3Cpath d='M10 10h80v10H10zM20 25h60v6H20zM25 35h10v85H25zM45 35h10v85H45zM65 35h10v85H65zM15 124h70v8H15zM10 134h80v6H10z'/%3E%3C/svg%3E")`,
          }}
        />

        {/* Brand Header */}
        <div className="flex h-[72px] shrink-0 items-center justify-between gap-2 border-b border-sidebar-border px-4 py-3">
          <Link href={isManager ? "/dashboard" : "/inbox"} className="flex flex-col group py-1">
            <div className="flex items-center gap-2">
              <CiclopesLogo
                layout="horizontal"
                size="sm"
                variant="white"
                showTagline={false}
                className="text-sidebar-foreground group-hover:opacity-95 transition-opacity"
              />
            </div>
            <span className="text-[8.5px] font-sans font-medium tracking-[0.12em] uppercase text-sidebar-foreground/60 pl-8 -mt-1">
              MUITAS CONVERSAS. UMA VISÃO.
            </span>
          </Link>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("closeMenu")}
            className="flex h-8 w-8 items-center justify-center rounded-md text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation Sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-4 scrollbar-thin scrollbar-thumb-white/10">
          {sections.map((sec, secIdx) => (
            <div key={secIdx} className="space-y-1">
              {sec.titleKey && (
                <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-sidebar-foreground/40 font-sans">
                  {t(sec.titleKey as string)}
                </div>
              )}
              <ul className="flex flex-col gap-0.5">
                {sec.items.map((item) => {
                  const isActive =
                    item.href === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname === item.href || pathname.startsWith(`${item.href}/`);

                  const showUnreadDot =
                    item.href === "/inbox" && totalUnread > 0 && !isActive;

                  const showNotificationBadge =
                    item.href === "/notifications" && unreadNotifications > 0;

                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={cn(
                          "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium transition-all",
                          isActive
                            ? "bg-white/[0.12] text-white font-semibold shadow-xs"
                            : "text-sidebar-foreground/75 hover:bg-white/[0.06] hover:text-white",
                        )}
                      >
                        {/* Active Terracotta Indicator Bar */}
                        {isActive && (
                          <span className="absolute left-0 top-1 bottom-1 w-1 rounded-r-full bg-[#D16A3A]" />
                        )}

                        <item.icon
                          className={cn(
                            "h-4 w-4 transition-transform group-hover:scale-105 shrink-0",
                            isActive ? "text-[#D16A3A]" : "text-sidebar-foreground/70 group-hover:text-white",
                          )}
                        />
                        <span className="flex-1 tracking-tight truncate">
                          {t(item.labelKey as string)}
                        </span>

                        {item.beta && (
                          <span
                            aria-label={t("beta")}
                            className="rounded-full border border-amber-500/40 bg-amber-500/10 px-1 py-0.2 text-[8px] font-semibold uppercase tracking-wider text-amber-300"
                          >
                            {t("beta")}
                          </span>
                        )}

                        {showUnreadDot && (
                          <span
                            aria-label={t("unreadConversations", { count: totalUnread })}
                            className="relative flex h-2 w-2"
                          >
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D16A3A] opacity-75" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D16A3A]" />
                          </span>
                        )}

                        {showNotificationBadge && (
                          <span
                            aria-label={t("unreadNotifications", { count: unreadNotifications })}
                            className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#D16A3A] px-1 text-[9px] font-semibold text-white"
                          >
                            {unreadNotifications > 9 ? "9+" : unreadNotifications}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

          {/* Bottom Nav Items (Settings / Profile) */}
          <div className="pt-2 border-t border-sidebar-border/60">
            <ul className="flex flex-col gap-0.5">
              {bottomNavItems.map((item) => {
                const isActive =
                  pathname === item.href ||
                  (item.href !== "/settings?tab=profile" && pathname.startsWith(item.href));

                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-xs font-medium transition-all",
                        isActive
                          ? "bg-white/[0.12] text-white font-semibold"
                          : "text-sidebar-foreground/75 hover:bg-white/[0.06] hover:text-white",
                      )}
                    >
                      {isActive && (
                        <span className="absolute left-0 top-1 bottom-1 w-1 rounded-r-full bg-[#D16A3A]" />
                      )}
                      <item.icon
                        className={cn(
                          "h-4 w-4 shrink-0",
                          isActive ? "text-[#D16A3A]" : "text-sidebar-foreground/70 group-hover:text-white",
                        )}
                      />
                      <span className="tracking-tight truncate">{t(item.labelKey as string)}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        {/* User / Account Footer */}
        <div className="shrink-0 border-t border-sidebar-border/80 p-2.5 bg-black/10">
          {showAccountStrip && account?.name ? (
            <div className="mb-1.5 flex items-center gap-1.5 px-2 text-[11px] text-sidebar-foreground/60">
              <UsersRound className="size-3 shrink-0 text-sidebar-foreground/40" />
              <span className="truncate max-w-[120px]" title={account.name}>
                {account.name}
              </span>
              {accountRole ? (
                (() => {
                  const meta = ROLE_CHIP[accountRole];
                  const Icon = meta.icon;
                  return (
                    <span
                      className={`ml-auto inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.2 text-[9px] font-medium uppercase tracking-wider ${meta.className}`}
                    >
                      <Icon className="size-2.5" />
                      {t(meta.labelKey as string)}
                    </span>
                  );
                })()
              ) : null}
            </div>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-white/[0.08] focus:bg-white/[0.08] focus:outline-none data-popup-open:bg-white/[0.08]">
              <div className="relative">
                <Avatar className="size-7 shrink-0 border border-sidebar-border">
                  {profile?.avatar_url ? (
                    <AvatarImage
                      src={profile.avatar_url}
                      alt={profile.full_name ?? t("defaultAvatar")}
                    />
                  ) : null}
                  <AvatarFallback className="bg-sidebar-accent text-xs font-medium text-white">
                    {profile?.full_name?.charAt(0)?.toUpperCase() ??
                      profile?.email?.charAt(0)?.toUpperCase() ??
                      "U"}
                  </AvatarFallback>
                </Avatar>
                {/* Active Online Indicator Dot */}
                <span className="absolute bottom-0 right-0 size-2 rounded-full bg-emerald-500 ring-1 ring-sidebar" />
              </div>

              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-white leading-tight">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="size-1.5 rounded-full bg-emerald-400" />
                  <span className="text-[10px] text-sidebar-foreground/60 leading-none">
                    {t("online")}
                  </span>
                </div>
              </div>

              <ChevronRight className="size-3.5 text-sidebar-foreground/40 shrink-0" />
            </DropdownMenuTrigger>

            <DropdownMenuContent
              align="end"
              side="top"
              sideOffset={6}
              className="min-w-52 bg-popover text-popover-foreground ring-border"
            >
              <div className="px-3 py-2 border-b border-border/60">
                <p className="text-xs font-semibold text-foreground truncate">
                  {profile?.full_name ?? t("defaultUser")}
                </p>
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                  {profile?.email ?? ""}
                </p>
              </div>

              <DropdownMenuItem
                render={
                  <Link
                    href="/settings?tab=profile"
                    onClick={onClose}
                    className="text-popover-foreground focus:bg-accent focus:text-accent-foreground text-xs"
                  />
                }
              >
                <User className="size-3.5 mr-2" />
                {t("menuProfile")}
              </DropdownMenuItem>

              {isManager && (
                <DropdownMenuItem
                  render={
                    <Link
                      href="/settings?tab=whatsapp"
                      onClick={onClose}
                      className="text-popover-foreground focus:bg-accent focus:text-accent-foreground text-xs"
                    />
                  }
                >
                  <Settings className="size-3.5 mr-2" />
                  {t("menuSettings")}
                </DropdownMenuItem>
              )}

              <DropdownMenuSeparator className="bg-border" />
              <DropdownMenuItem
                onClick={signOut}
                className="text-destructive focus:bg-destructive/10 focus:text-destructive text-xs"
              >
                <LogOut className="size-3.5 mr-2" />
                {t("menuSignOut")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </aside>
    </>
  );
}

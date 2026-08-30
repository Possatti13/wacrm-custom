"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/hooks/use-auth";
import { useUnreadNotifications } from "@/hooks/use-unread-notifications";
import {
  Bell,
  HelpCircle,
  LogOut,
  Menu,
  Search,
  Settings as SettingsIcon,
  User,
} from "lucide-react";
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
import { ModeToggle } from "@/components/layout/mode-toggle";
import { useTranslations } from "next-intl";

const pageTitles: Record<string, string> = {
  "/dashboard": "dashboard",
  "/inbox": "inbox",
  "/tasks": "tasks",
  "/contacts": "contacts",
  "/pipelines": "pipelines",
  "/catalog": "catalog",
  "/settings": "settings",
  "/notifications": "notifications",
};

function getPageTitleKey(pathname: string): string {
  if (pageTitles[pathname]) return pageTitles[pathname];
  const match = Object.entries(pageTitles).find(([path]) =>
    pathname.startsWith(path),
  );
  return match ? match[1] : "dashboard";
}

interface HeaderProps {
  /** Wired to the shell's drawer state. Used only on mobile. */
  onOpenSidebar?: () => void;
}

export function Header({ onOpenSidebar }: HeaderProps) {
  const t = useTranslations("Header");
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const unreadNotifications = useUnreadNotifications();
  const titleKey = getPageTitleKey(pathname);

  const initial =
    profile?.full_name?.charAt(0)?.toUpperCase() ??
    profile?.email?.charAt(0)?.toUpperCase() ??
    "U";

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border bg-card/60 backdrop-blur-xs px-4 lg:px-6">
      <div className="flex min-w-0 items-center gap-2">
        {/* Hamburger — mobile only */}
        <button
          type="button"
          onClick={onOpenSidebar}
          aria-label={t("openMenu")}
          className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="truncate text-sm sm:text-base font-semibold text-foreground font-sans tracking-tight">
          {t(titleKey as string)}
        </h1>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2">
        {/* Notifications Icon Button */}
        <Link
          href="/notifications"
          className="relative flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title={t("notifications")}
        >
          <Bell className="h-4 w-4" />
          {unreadNotifications > 0 && (
            <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#D16A3A] opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#D16A3A]" />
            </span>
          )}
        </Link>

        {/* Theme Mode Toggle */}
        <ModeToggle />

        {/* User Dropdown */}
        <DropdownMenu>
          <DropdownMenuTrigger
            className="flex items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-muted/70 focus:bg-muted/70 focus:outline-none data-popup-open:bg-muted/70 sm:gap-2.5 sm:pl-1 sm:pr-2.5"
            aria-label={t("openAccountMenu")}
          >
            <Avatar className="size-7 sm:size-8 border border-border">
              {profile?.avatar_url ? (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile.full_name ?? t("defaultAvatar")}
                />
              ) : null}
              <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                {initial}
              </AvatarFallback>
            </Avatar>
            <span className="hidden text-xs font-medium text-foreground sm:inline truncate max-w-[130px]">
              {profile?.full_name ?? t("defaultUser")}
            </span>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            sideOffset={6}
            className="min-w-52 bg-popover text-popover-foreground ring-border"
          >
            <div className="px-3 py-2 border-b border-border/60">
              <p className="truncate text-xs font-semibold text-foreground">
                {profile?.full_name ?? t("defaultUser")}
              </p>
              <p className="truncate text-[11px] text-muted-foreground mt-0.5">
                {profile?.email ?? ""}
              </p>
            </div>

            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=profile"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground text-xs"
                />
              }
            >
              <User className="size-3.5 mr-2" />
              {t("menuProfile")}
            </DropdownMenuItem>

            <DropdownMenuItem
              render={
                <Link
                  href="/settings?tab=whatsapp"
                  className="text-popover-foreground focus:bg-accent focus:text-accent-foreground text-xs"
                />
              }
            >
              <SettingsIcon className="size-3.5 mr-2" />
              {t("menuSettings")}
            </DropdownMenuItem>

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
    </header>
  );
}

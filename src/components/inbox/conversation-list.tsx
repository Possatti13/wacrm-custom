"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  matchesContactFilters,
  matchesSellerVisibility,
  normalizeConversations,
} from "@/lib/inbox/conversations";
import { useAuth } from "@/hooks/use-auth";
import { fetchAccountMembers } from "@/lib/account/members";
import type { AccountMember } from "@/types";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationStatus, Tag } from "@/types";
import { Search, SlidersHorizontal, X, User, Star, Check, CheckCheck } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface ConversationListProps {
  activeConversationId: string | null;
  onSelect: (conversation: Conversation) => void;
  conversations: Conversation[];
  onConversationsLoaded: (conversations: Conversation[]) => void;
  resyncToken?: number;
}

type MainViewSegment = "all" | "mine" | "priority";

export function ConversationList({
  activeConversationId,
  onSelect,
  conversations,
  onConversationsLoaded,
  resyncToken = 0,
}: ConversationListProps) {
  const t = useTranslations("Inbox.conversationList");
  const { user, accountRole, accountId } = useAuth();

  const [search, setSearch] = useState("");
  const [mainSegment, setMainSegment] = useState<MainViewSegment>("all");
  const [statusFilter, setStatusFilter] = useState<ConversationStatus | "all">("all");
  const [members, setMembers] = useState<AccountMember[]>([]);
  const [sellerVisibility, setSellerVisibility] = useState<"all" | "assigned_and_unassigned" | "assigned_only">("all");
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<Tag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mems = await fetchAccountMembers();
      if (!cancelled) setMembers(mems);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!accountId) return;
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("accounts")
        .select("seller_conversation_visibility")
        .eq("id", accountId)
        .maybeSingle();
      if (!cancelled && data?.seller_conversation_visibility) {
        setSellerVisibility(data.seller_conversation_visibility as "all" | "assigned_and_unassigned" | "assigned_only");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const onConversationsLoadedRef = useRef(onConversationsLoaded);
  useEffect(() => {
    onConversationsLoadedRef.current = onConversationsLoaded;
  });

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .order("last_message_at", { ascending: false });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch conversations:", {
          message: error.message,
          details: error.details,
          code: error.code,
        });
        setLoading(false);
        return;
      }

      onConversationsLoadedRef.current(normalizeConversations(data ?? []));
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [resyncToken]);

  useEffect(() => {
    const supabase = createClient();
    let cancelled = false;
    (async () => {
      const { data } = await supabase.from("tags").select("*").order("name");
      if (!cancelled && data) setTags(data as Tag[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const companies = useMemo(() => {
    const set = new Set<string>();
    for (const c of conversations) {
      const co = c.contact?.company?.trim();
      if (co) set.add(co);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [conversations]);

  const tagsById = useMemo(() => {
    const m = new Map<string, Tag>();
    for (const tag of tags) m.set(tag.id, tag);
    return m;
  }, [tags]);

  const filtered = useMemo(() => {
    let result = conversations;

    // 1. Tenant seller visibility policy
    result = result.filter((c) =>
      matchesSellerVisibility(c, accountRole, user?.id, sellerVisibility)
    );

    // 2. Main 3 Segments (Todas, Minhas, Prioridade)
    if (mainSegment === "mine" && user?.id) {
      result = result.filter((c) => c.assigned_agent_id === user.id);
    } else if (mainSegment === "priority") {
      result = result.filter((c) => {
        const score = c.contact?.lead_score?.score ?? c.contact?.lead_profile?.lead_score ?? null;
        const urgency = c.contact?.lead_profile?.urgency;
        return (score !== null && score >= 70) || urgency === "high";
      });
    }

    // 3. Status filter from advanced dropdown
    if (statusFilter !== "all") {
      result = result.filter((c) => c.status === statusFilter);
    }

    // 4. Contact tags & company
    if (selectedTagIds.length > 0 || selectedCompany !== null) {
      result = result.filter((c) =>
        matchesContactFilters(c, {
          tagIds: selectedTagIds,
          company: selectedCompany,
        })
      );
    }

    // 5. Search query
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((c) => {
        const name = c.contact?.name?.toLowerCase() ?? "";
        const phone = c.contact?.phone?.toLowerCase() ?? "";
        const lastMsg = c.last_message_text?.toLowerCase() ?? "";
        return name.includes(q) || phone.includes(q) || lastMsg.includes(q);
      });
    }

    return result;
  }, [
    conversations,
    mainSegment,
    statusFilter,
    sellerVisibility,
    accountRole,
    user?.id,
    search,
    selectedTagIds,
    selectedCompany,
  ]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  }, []);

  const hasAdvancedFilters =
    statusFilter !== "all" || selectedTagIds.length > 0 || selectedCompany !== null;

  return (
    <div className="flex h-full w-full flex-col border-r border-border bg-card lg:w-[340px] shrink-0">
      {/* Top Header matching Visual Reference 4 */}
      <div className="p-3.5 pb-2 border-b border-border/60 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold tracking-tight text-foreground font-sans">
            Conversas
          </h2>

          {/* Advanced Filter Popover */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors",
                hasAdvancedFilters && "text-primary bg-primary/10"
              )}
              title="Filtros avançados"
            >
              <SlidersHorizontal className="size-3.5" />
            </DropdownMenuTrigger>

            <DropdownMenuContent align="end" className="w-56 bg-popover text-popover-foreground">
              <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                Filtrar por status
              </div>
              <DropdownMenuItem
                onClick={() => setStatusFilter("all")}
                className={cn("text-xs", statusFilter === "all" && "font-semibold text-primary")}
              >
                Todas as conversas
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setStatusFilter("open")}
                className={cn("text-xs", statusFilter === "open" && "font-semibold text-primary")}
              >
                Abertas
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setStatusFilter("pending")}
                className={cn("text-xs", statusFilter === "pending" && "font-semibold text-primary")}
              >
                Aguardando cliente
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setStatusFilter("closed")}
                className={cn("text-xs", statusFilter === "closed" && "font-semibold text-primary")}
              >
                Fechadas
              </DropdownMenuItem>

              {tags.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                    Tags
                  </div>
                  {tags.map((tag) => (
                    <DropdownMenuCheckboxItem
                      key={tag.id}
                      checked={selectedTagIds.includes(tag.id)}
                      onCheckedChange={() => toggleTag(tag.id)}
                      className="text-xs"
                    >
                      <span
                        className="mr-2 size-2 rounded-full"
                        style={{ backgroundColor: tag.color ?? "#94A3B8" }}
                      />
                      <span className="truncate">{tag.name}</span>
                    </DropdownMenuCheckboxItem>
                  ))}
                </>
              )}

              {companies.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground">
                    Empresa
                  </div>
                  {companies.map((co) => (
                    <DropdownMenuItem
                      key={co}
                      onClick={() =>
                        setSelectedCompany(selectedCompany === co ? null : co)
                      }
                      className={cn(
                        "text-xs truncate",
                        selectedCompany === co && "font-semibold text-primary"
                      )}
                    >
                      {co}
                    </DropdownMenuItem>
                  ))}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Search Bar */}
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conversas..."
            className="h-8 pl-8 pr-3 text-xs bg-muted/50 border-border/80 rounded-lg placeholder-muted-foreground focus-visible:ring-primary/40"
          />
        </div>

        {/* Segmented Filter Pills matching Visual Reference 4 */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setMainSegment("all")}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all text-center",
              mainSegment === "all"
                ? "bg-[#1E3A5F] text-white shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            Todas
          </button>

          <button
            type="button"
            onClick={() => setMainSegment("mine")}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all text-center",
              mainSegment === "mine"
                ? "bg-[#1E3A5F] text-white shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            Minhas
          </button>

          <button
            type="button"
            onClick={() => setMainSegment("priority")}
            className={cn(
              "flex-1 py-1.5 px-2 rounded-md text-xs font-semibold transition-all flex items-center justify-center gap-1",
              mainSegment === "priority"
                ? "bg-[#1E3A5F] text-white shadow-xs"
                : "bg-muted/60 text-muted-foreground hover:text-foreground hover:bg-muted"
            )}
          >
            <Star className="size-3 fill-current" />
            <span>Prioridade</span>
          </button>
        </div>
      </div>

      {/* Conversation List Scroll Area */}
      <ScrollArea className="flex-1 min-h-0">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-16 bg-muted/40 animate-pulse rounded-lg border border-border/40" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-12 text-center text-muted-foreground space-y-1">
            <p className="text-xs font-semibold">Nenhuma conversa encontrada</p>
            <p className="text-[11px]">Tente ajustar a busca ou os filtros acima.</p>
          </div>
        ) : (
          <div className="divide-y divide-border/40">
            {filtered.map((conv) => {
              const contact = conv.contact;
              const displayName =
                contact?.name ||
                contact?.phone ||
                (contact?.whatsapp_lid ? "Contato WhatsApp" : "Contato");
              const initials = displayName.charAt(0).toUpperCase();
              const isActive = conv.id === activeConversationId;

              const formatMsgTime = () => {
                if (!conv.last_message_at) return "";
                const d = new Date(conv.last_message_at);
                if (isToday(d)) return format(d, "HH:mm", { locale: ptBR });
                if (isYesterday(d)) return "Ontem";
                return format(d, "dd/MM", { locale: ptBR });
              };

              return (
                <button
                  key={conv.id}
                  type="button"
                  onClick={() => onSelect(conv)}
                  className={cn(
                    "flex w-full items-start gap-3 p-3.5 text-left transition-all relative group",
                    isActive
                      ? "bg-orange-500/[0.08] dark:bg-orange-500/[0.12] border-l-[3.5px] border-[#D16A3A]"
                      : "hover:bg-muted/40 border-l-[3.5px] border-transparent"
                  )}
                >
                  {/* Avatar */}
                  <Avatar className="size-10 shrink-0 border border-border">
                    {contact?.avatar_url ? (
                      <AvatarImage src={contact.avatar_url} alt={displayName} />
                    ) : null}
                    <AvatarFallback className="bg-primary/10 text-xs font-bold text-primary">
                      {initials}
                    </AvatarFallback>
                  </Avatar>

                  {/* Body */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "truncate text-xs font-bold font-sans",
                          isActive ? "text-foreground" : "text-foreground/90"
                        )}
                      >
                        {displayName}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 font-medium">
                        {formatMsgTime()}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="truncate text-xs text-muted-foreground leading-tight">
                        {conv.last_message_text || "Sem mensagens recentes"}
                      </p>

                      {conv.unread_count > 0 ? (
                        <span className="flex size-4.5 min-w-4.5 items-center justify-center rounded-full bg-[#D16A3A] px-1 text-[10px] font-bold text-white shrink-0 shadow-xs">
                          {conv.unread_count}
                        </span>
                      ) : (
                        <CheckCheck className="size-3 text-muted-foreground/60 shrink-0" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Footer count indicator */}
      <div className="p-2 border-t border-border/50 text-center text-[10px] text-muted-foreground bg-muted/20">
        {filtered.length} {filtered.length === 1 ? "conversa" : "conversas"}
      </div>
    </div>
  );
}

"use client";

import { useState, useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import {
  CONVERSATION_SELECT,
  normalizeConversation,
} from "@/lib/inbox/conversations";
import type { Conversation, Message, ConversationStatus } from "@/types";
import { useRealtime } from "@/hooks/use-realtime";
import { mergeIncomingMessage, reconcileSentMessage, mergeMessageSnapshot } from "@/lib/inbox/message-state";
import { ConversationList } from "@/components/inbox/conversation-list";
import { MessageThread } from "@/components/inbox/message-thread";
import { IntelligenceSidebar } from "@/components/inbox/intelligence-sidebar";
import { toast } from "sonner";
import { WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

import { Sheet, SheetContent } from "@/components/ui/sheet";

// Remembers the agent's show/hide choice for the desktop contact panel
// across reloads and sessions (device-scoped, like the theme prefs).
const CONTACT_PANEL_STORAGE_KEY = "wacrm:inbox:contact-panel-open";

const wideQuery = "(min-width: 1440px)";
const subscribeWidth = (listener: () => void) => {
  const query = window.matchMedia(wideQuery);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};
const readWidth = () => window.matchMedia(wideQuery).matches;
const serverWidth = () => false;

export default function InboxPage() {
  const t = useTranslations("Inbox.page");
  const searchParams = useSearchParams();
  /**
   * `?c=<id>` deep-link support. Used when landing here from the
   * dashboard's recent-conversations list so the right thread opens
   * automatically instead of showing the empty center panel.
   */
  const deepLinkConvId = searchParams.get("c");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  // The URL owns selection. Keep the selected row as a local snapshot for
  // optimistic unread/status updates, never as a second selected ID.
  const [selectedConversation, setActiveConversation] = useState<Conversation | null>(null);
  const activeConversation = selectedConversation?.id === deepLinkConvId
    ? selectedConversation
    : conversations.find(conversation => conversation.id === deepLinkConvId) ?? null;
  const activeContact = activeConversation?.contact ?? null;
  const [messageCache, setMessageCache] = useState<Record<string, Message[]>>({});
  const messages = messageCache[activeConversation?.id ?? ""] ?? [];
  const [whatsappConnected, setWhatsappConnected] = useState<boolean | null>(
    null
  );
  const [mobileContextOpen, setMobileContextOpen] = useState(false);
  const wideViewport = useSyncExternalStore(subscribeWidth, readWidth, serverWidth);
  useEffect(() => { if (wideViewport) setMobileContextOpen(false); }, [wideViewport]);
  /**
   * Bumped whenever we want children (ConversationList, MessageThread)
   * to refetch from the DB — used as a safety net against missed
   * realtime events. Bumped on WS reconnect and on tab visibility →
   * visible. The initial mount fetches don't depend on this; they fire
   * once on conversationId-change as usual.
   */
  const [resyncToken, setResyncToken] = useState(0);

  /**
   * Whether the desktop contact sidebar (tags / deals / notes) is shown.
   * Defaults to `true` (the historical behaviour) and is restored from
   * localStorage after mount. We deliberately do NOT read localStorage in
   * the initializer: the server renders with `true`, so reading a stored
   * `false` synchronously would produce a hydration mismatch. The effect
   * below reconciles to the stored value right after mount instead.
   */
  const [contactPanelOpen, setContactPanelOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = localStorage.getItem(CONTACT_PANEL_STORAGE_KEY);
      if (stored !== null) setContactPanelOpen(stored === "true");
    } catch {
      // localStorage can throw in private-browsing / sandboxed contexts.
    }
  }, []);

  const handleToggleContactPanel = useCallback(() => {
    if (typeof window !== "undefined" && window.innerWidth < 1440) {
      setMobileContextOpen((prev) => !prev);
      return;
    }

    setContactPanelOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(CONTACT_PANEL_STORAGE_KEY, String(next));
      } catch {
        // Persistence is best-effort; ignore storage failures.
      }
      return next;
    });
  }, []);

  // Tracks conversations whose hydrate fetch is currently in flight. The
  // conv-INSERT and the first-message-INSERT events both call into
  // hydrateConversation; the dedupe here keeps it at one refetch per
  // new conversation even when both events arrive within milliseconds.
  const hydratingConvIdsRef = useRef<Set<string>>(new Set());

  /**
   * Synchronous mirror of the conversation ids currently in `conversations`
   * state. Event handlers need to know "do we already have this conv?"
   * without waiting for a setState updater to run — updaters fire during
   * reconciliation, *after* the synchronous handler code returns, so a
   * `let foundInList = false; setState(p => { foundInList = ...; return ... })`
   * flag reads as `false` in the same tick (this exact bug shipped in #105
   * and caused #106: every incoming message and every status flip fired a
   * redundant DB hydrate, swamping the supabase client and starving the
   * realtime channel). The ref is kept in sync via the effect below.
   */
  const knownConvIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const next = new Set<string>();
    for (const c of conversations) next.add(c.id);
    knownConvIdsRef.current = next;
  }, [conversations]);

  // Pull the conversation row with its `contact` joined and merge it
  // into state. Needed because Supabase Realtime payloads only carry the
  // row's own columns — a brand-new conversation arrives without a
  // contact, which surfaced as "Unknown" names, empty avatars, and
  // (when the conv-INSERT event was delayed past the message-INSERT)
  // conversations stuck on "No messages yet" until the user reloaded.
  // Also self-heals if a realtime event was missed: callers can invoke
  // this whenever they reference a conversation id they don't recognise.
  const hydrateConversation = useCallback(async (convId: string) => {
    if (hydratingConvIdsRef.current.has(convId)) return;
    hydratingConvIdsRef.current.add(convId);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("conversations")
        .select(CONVERSATION_SELECT)
        .eq("id", convId)
        .maybeSingle();
      if (error) {
        // Supabase errors have non-enumerable properties — log fields
        // explicitly so the console message isn't just `{}`.
        console.error("Failed to hydrate conversation:", {
          message: error.message,
          details: error.details,
          hint: error.hint,
          code: error.code,
        });
        return;
      }
      if (!data) return;
      const fetched = normalizeConversation(data);
      setConversations((prev) => {
        const existing = prev.find((c) => c.id === fetched.id);
        if (existing) {
          // Already in state — keep its fields (a realtime UPDATE may
          // have landed while the fetch was in flight and patched
          // last_message_text / unread_count to fresher values than
          // the row we just read). Only backfill `contact`, which the
          // realtime payloads never carry.
          return prev.map((c) =>
            c.id === fetched.id
              ? { ...c, contact: c.contact ?? fetched.contact }
              : c,
          );
        }
        return [fetched, ...prev];
      });
    } finally {
      hydratingConvIdsRef.current.delete(convId);
    }
  }, []);

  // Check WhatsApp connection status on mount
  useEffect(() => {
    const checkConnection = async () => {
      const supabase = createClient();
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;

      if (!user) return;

      // whatsapp_config is one-row-per-account post-multi-user, so
      // the previous `.eq('user_id', user.id)` would miss the row
      // for any teammate who didn't personally save the config —
      // the "WhatsApp not connected" banner would show in the
      // shared inbox even though the admin had it configured.
      // Resolve account_id via the profile and query by that.
      const { data: profile } = await supabase
        .from("profiles")
        .select("account_id")
        .eq("user_id", user.id)
        .maybeSingle();
      const accountId = profile?.account_id as string | undefined;
      if (!accountId) {
        setWhatsappConnected(false);
        return;
      }

      const { data } = await supabase
        .from("whatsapp_config")
        .select("status, provider")
        .eq("account_id", accountId)
        .maybeSingle();

      if (data?.status === "connected") {
        setWhatsappConnected(true);
        return;
      }

      if (data?.provider === "waha") {
        try {
          const res = await fetch("/api/whatsapp/waha/session", { cache: "no-store" });
          if (res.ok) {
            const sess = await res.json();
            if (sess.connected || sess.session?.status === "WORKING") {
              setWhatsappConnected(true);
              return;
            }
          }
        } catch {
          // Ignore live probe failure
        }
      }

      setWhatsappConnected(false);
    };

    checkConnection();
  }, []);

  // Handle realtime message events
  const handleMessageEvent = useCallback(
    (event: { eventType: string; new: Message; old: Partial<Message> }) => {
      const newMsg = event.new;

      if (event.eventType === "INSERT") {
        // Add to messages if it belongs to active conversation
        if (
          activeConversation &&
          newMsg.conversation_id === activeConversation.id
        ) {
          setMessageCache(previous => ({ ...previous,
            [newMsg.conversation_id]: mergeIncomingMessage(previous[newMsg.conversation_id] ?? [], newMsg),
          }));
        }

        // Update conversation list preview. We need to know *synchronously*
        // whether the conv is already in state to decide between patching
        // the preview and triggering a hydrate — see the comment on
        // knownConvIdsRef for why a closure flag inside the updater would
        // always read false here.
        if (knownConvIdsRef.current.has(newMsg.conversation_id)) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === newMsg.conversation_id
                ? {
                    ...c,
                    last_message_text: newMsg.content_text ?? "",
                    last_message_at: newMsg.created_at,
                    unread_count:
                      activeConversation?.id === newMsg.conversation_id
                        ? 0
                        : c.unread_count + 1,
                  }
                : c,
            ),
          );
        } else {
          // First time we're seeing this conv: the conv-INSERT event
          // hasn't landed yet, or was missed. Hydrate from the DB so
          // the row surfaces with its `contact` joined; the conv-UPDATE
          // event the webhook emits right after the message INSERT will
          // converge state when it arrives.
          hydrateConversation(newMsg.conversation_id);
        }
      }

      if (event.eventType === "UPDATE") {
        // Update message status
        setMessageCache(previous => ({ ...previous,
          [newMsg.conversation_id]: (previous[newMsg.conversation_id] ?? []).map(m => m.id === newMsg.id ? { ...m, ...newMsg } : m),
        }));
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Handle realtime conversation events
  const handleConversationEvent = useCallback(
    (event: {
      eventType: string;
      new: Conversation;
      old: Partial<Conversation>;
    }) => {
      const conv = event.new;

      if (event.eventType === "INSERT") {
        // Prepend immediately for snappy UX so the new conv shows in the
        // list right away, then hydrate to fill in the `contact` join
        // (realtime payloads never include joins). Skip both if we
        // already have the row — that shouldn't happen normally, but
        // out-of-order delivery would have us prepending a duplicate.
        if (!knownConvIdsRef.current.has(conv.id)) {
          setConversations((prev) => {
            if (prev.some((c) => c.id === conv.id)) return prev;
            return [conv, ...prev];
          });
          hydrateConversation(conv.id);
        }
      }

      if (event.eventType === "UPDATE") {
        if (knownConvIdsRef.current.has(conv.id)) {
          // If this UPDATE is for the conv the user is currently viewing,
          // suppress the incoming unread_count — the user is reading it
          // RIGHT NOW, so any positive value would just flicker the badge
          // back on for the ~100ms it takes for the reset effect's server
          // UPDATE to round-trip. Non-active convs take the value as-is.
          const isActive = activeConversation?.id === conv.id;
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conv.id
                ? {
                    ...c,
                    ...conv,
                    unread_count: isActive ? 0 : conv.unread_count,
                  }
                : c,
            ),
          );
        } else {
          // UPDATE arrived before the INSERT (or after a missed INSERT)
          // — fetch the row so it surfaces with its contact joined. The
          // patch contained in `conv` will already be reflected in what
          // the hydrate fetch returns.
          hydrateConversation(conv.id);
        }

        // Update active conversation if it changed
        if (activeConversation && conv.id === activeConversation.id) {
          setActiveConversation((prev) =>
            prev ? { ...prev, ...conv } : prev
          );
        }
      }
    },
    [activeConversation, hydrateConversation]
  );

  // Subscribe to realtime. The `isConnected` flag below feeds the
  // reconnect resync: realtime is best-effort and events sent while the
  // WS was disconnected (laptop sleep, network blip, background-tab
  // throttle) are simply lost. We need a way to catch up.
  const { isConnected } = useRealtime({
    channelName: "inbox-realtime",
    onMessageEvent: handleMessageEvent,
    onConversationEvent: handleConversationEvent,
    enabled: true,
  });

  /**
   * Bump `resyncToken` whenever the realtime channel transitions from
   * disconnected → connected *after* the initial connect. The initial
   * connect is covered by the children's on-mount fetches; only later
   * reconnects need a manual refetch to fill the gap.
   *
   * Tracked via a `was-connected` ref rather than a count so that React
   * strict-mode's dev-only effect double-fire doesn't read as a
   * reconnect.
   */
  const wasConnectedRef = useRef(false);
  const initialConnectDoneRef = useRef(false);
  useEffect(() => {
    if (isConnected && !wasConnectedRef.current) {
      // false → true transition
      if (initialConnectDoneRef.current) {
        setResyncToken((n) => n + 1);
      } else {
        initialConnectDoneRef.current = true;
      }
    }
    wasConnectedRef.current = isConnected;
  }, [isConnected]);

  /**
   * Refetch when the tab regains focus. Background tabs may have their
   * WS throttled by the browser even without a full disconnect, so a
   * visibilitychange → visible is a reliable signal that we may have
   * missed events. Cheap to fire; the children dedupe on their own.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        setResyncToken((n) => n + 1);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  /**
   * Manual refresh trigger for the thread-header refresh button.
   * Bumps the same resyncToken the reconnect / visibility paths use,
   * so it goes through the existing dedupe & refetch plumbing — no
   * separate code path to keep in sync.
   */
  const handleManualRefresh = useCallback(() => {
    setResyncToken((n) => n + 1);
  }, []);

  const handleConversationsLoaded = useCallback((loaded: Conversation[]) => {
    const selected = loaded.find(conversation => conversation.id === deepLinkConvId) ?? null;
    // Preserve the raw unread count on the active row so MessageThread still
    // persists its read receipt; the list may clear its badge optimistically.
    setActiveConversation(selected);
    setConversations(loaded.map(conversation => conversation.id === selected?.id && conversation.unread_count > 0
      ? { ...conversation, unread_count: 0 } : conversation));
  }, [deepLinkConvId]);

  const handleSelectConversation = useCallback((conv: Conversation) => {
    if (new URLSearchParams(window.location.search).get("c") === conv.id) return;
    // Next 16.2's optimized same-path navigation can reuse a stale canonical
    // query from its route cache. This client-only selection uses Next's
    // documented History API bridge, which also updates useSearchParams.
    // No timeout, server navigation, or private router state manipulation.
    window.history.replaceState(null, "", `/inbox?c=${encodeURIComponent(conv.id)}`);
    setActiveConversation(conv);
    setConversations(previous => previous.map(conversation =>
      conversation.id === conv.id && conversation.unread_count > 0
        ? { ...conversation, unread_count: 0 } : conversation));
  }, []);

  // Replace, rather than push: choosing a row does not add browser history.
  const handleCloseConversation = useCallback(() => {
    window.history.replaceState(null, "", "/inbox");
    setActiveConversation(null);
  }, []);

  const handleMessagesLoaded = useCallback((loaded: Message[], conversationId: string, before: Message[]) => {
    setMessageCache(previous => ({ ...previous,
      [conversationId]: mergeMessageSnapshot(previous[conversationId] ?? [], loaded, before),
    }));
  }, []);

  const handleNewMessage = useCallback((msg: Message) => {
    setMessageCache(previous => ({ ...previous,
      [msg.conversation_id]: mergeIncomingMessage(previous[msg.conversation_id] ?? [], msg),
    }));
  }, []);

  const handleUpdateMessage = useCallback((id: string, updates: Partial<Message>) => {
    setMessageCache(previous => Object.fromEntries(Object.entries(previous).map(([key, rows]) =>
      [key, reconcileSentMessage(rows, id, updates)])));
  }, []);

  const handleStatusChange = useCallback(
    (conversationId: string, status: ConversationStatus) => {
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, status } : c))
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) => (prev?.id === conversationId ? { ...prev, status } : prev));
      }
    },
    [activeConversation]
  );

  const handleAssignChange = useCallback(
    (conversationId: string, assignedAgentId: string | null) => {
      setConversations((prev) =>
        prev.map((c) =>
          c.id === conversationId
            ? { ...c, assigned_agent_id: assignedAgentId ?? undefined }
            : c
        )
      );
      if (activeConversation?.id === conversationId) {
        setActiveConversation((prev) =>
          prev?.id === conversationId
            ? { ...prev, assigned_agent_id: assignedAgentId ?? undefined }
            : prev
        );
      }
    },
    [activeConversation]
  );

  const handleJumpToMessage = useCallback((messageId: string) => {
    const el = document.getElementById(`msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("ring-2", "ring-primary", "rounded-lg");
      setTimeout(() => {
        el.classList.remove("ring-2", "ring-primary");
      }, 3000);
    } else {
      toast.info("Mensagem citada fora do histórico recente carregado.");
    }
  }, []);

  const hasActiveConv = !!activeConversation;

  return (
    <div className={cn("flex h-full min-h-0 w-full flex-col overflow-hidden", !hasActiveConv && "pb-16 lg:pb-0")}>
      {/* WhatsApp connection banner */}
      {whatsappConnected === false && (
        <div className="flex shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2">
          <WifiOff className="h-4 w-4 text-amber-400" />
          <p className="text-xs text-amber-400">
            {t("whatsappNotConnected")}
          </p>
        </div>
      )}

      <div className="flex flex-1 min-h-0 overflow-hidden min-w-0 w-full">
        {/* Left panel: Conversation list.
            Takes full width on mobile when no conversation is selected.
            Fixed width (320px) on lg+. */}
        <div
          className={cn(
            "h-full min-h-0 min-w-0",
            hasActiveConv ? "hidden lg:flex lg:w-[320px] shrink-0" : "flex w-full lg:w-[320px] lg:shrink-0",
          )}
        >
          <ConversationList
            activeConversationId={activeConversation?.id ?? null}
            onSelect={handleSelectConversation}
            conversations={conversations}
            onConversationsLoaded={handleConversationsLoaded}
            resyncToken={resyncToken}
          />
        </div>

        {/* Center panel: Message thread.
            Takes full width on mobile when a conversation is selected.
            Flex-1 on lg+. */}
        <div
          className={cn(
            "h-full min-h-0 min-w-0 flex-1 w-full",
            hasActiveConv ? "flex flex-1" : "hidden lg:flex",
          )}
        >
          <MessageThread
            conversation={activeConversation}
            contact={activeContact}
            messages={messages}
            onMessagesLoaded={handleMessagesLoaded}
            onNewMessage={handleNewMessage}
            onUpdateMessage={handleUpdateMessage}
            onStatusChange={handleStatusChange}
            onAssignChange={handleAssignChange}
            onBack={handleCloseConversation}
            resyncToken={resyncToken}
            onRefresh={handleManualRefresh}
            contactPanelOpen={wideViewport ? contactPanelOpen : mobileContextOpen}
            onToggleContactPanel={handleToggleContactPanel}
          />
        </div>

        {/* Right panel: Continuous Intelligence & Context Sidebar (Desktop >= 1440px) */}
        {contactPanelOpen && (
          <div className="hidden min-[1440px]:block w-[360px] shrink-0 h-full min-h-0 border-l border-border bg-card">
            <IntelligenceSidebar
              contact={activeContact}
              conversationId={activeConversation?.id}
              onJumpToMessage={handleJumpToMessage}
            />
          </div>
        )}

        {/* Mobile / Tablet Slide-Over Sheet for Commercial Context (< 1440px) */}
        {/* Unmount the whole modal at the breakpoint, including its portal,
            backdrop and focus trap; hiding only the popup can strand them. */}
        {!wideViewport && <Sheet open={mobileContextOpen} onOpenChange={setMobileContextOpen}>
          <SheetContent
            side="right"
            aria-label="Contexto comercial"
            className="data-[side=right]:w-full sm:data-[side=right]:max-w-[380px] p-0 border-l border-border bg-card text-foreground"
          >
            <div className="h-full min-h-0 flex flex-col">
              <IntelligenceSidebar
                contact={activeContact}
                conversationId={activeConversation?.id}
                onJumpToMessage={handleJumpToMessage}
              />
            </div>
          </SheetContent>
        </Sheet>}
      </div>
    </div>
  );
}


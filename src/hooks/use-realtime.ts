"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Message, Conversation } from "@/types";
import type { RealtimeChannel } from "@supabase/supabase-js";

interface RealtimeEvent<T> {
  eventType: "INSERT" | "UPDATE" | "DELETE";
  new: T;
  old: Partial<T>;
}

interface UseRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  enabled?: boolean;
}

export interface SetupRealtimeOptions {
  channelName: string;
  onMessageEvent?: (event: RealtimeEvent<Message>) => void;
  onConversationEvent?: (event: RealtimeEvent<Conversation>) => void;
  onStatusChange?: (status: string) => void;
}

export function setupRealtimeSubscription(
  supabase: ReturnType<typeof createClient>,
  options: SetupRealtimeOptions
) {
  const uniqueChannelName = options.channelName.includes('-') && options.channelName.split('-').length > 2
    ? options.channelName
    : `${options.channelName}-${Math.random().toString(36).slice(2)}`;

  const channel = supabase
    .channel(uniqueChannelName)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages' },
      (payload) => {
        options.onMessageEvent?.({
          eventType: payload.eventType as RealtimeEvent<Message>['eventType'],
          new: payload.new as Message,
          old: payload.old as Partial<Message>,
        });
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'conversations' },
      (payload) => {
        options.onConversationEvent?.({
          eventType: payload.eventType as RealtimeEvent<Conversation>['eventType'],
          new: payload.new as Conversation,
          old: payload.old as Partial<Conversation>,
        });
      }
    )
    .subscribe((status) => {
      options.onStatusChange?.(status);
    });

  return {
    channel,
    unsubscribe: () => {
      supabase.removeChannel(channel);
    },
  };
}

export function useRealtime({
  channelName,
  onMessageEvent,
  onConversationEvent,
  enabled = true,
}: UseRealtimeOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  // Store latest callbacks in refs to avoid re-subscribing when the
  // parent re-renders with fresh closures.
  const onMessageRef = useRef(onMessageEvent);
  const onConversationRef = useRef(onConversationEvent);
  useEffect(() => {
    onMessageRef.current = onMessageEvent;
    onConversationRef.current = onConversationEvent;
  });

  useEffect(() => {
    if (!enabled) return;

    const supabase = createClient();
    const sub = setupRealtimeSubscription(supabase, {
      channelName,
      onMessageEvent: (event) => onMessageRef.current?.(event),
      onConversationEvent: (event) => onConversationRef.current?.(event),
      onStatusChange: (status) => setIsConnected(status === 'SUBSCRIBED'),
    });

    channelRef.current = sub.channel;

    return () => {
      sub.unsubscribe();
      channelRef.current = null;
      setIsConnected(false);
    };
  }, [channelName, enabled]);

  const unsubscribe = useCallback(() => {
    if (channelRef.current) {
      const supabase = createClient();
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
      setIsConnected(false);
    }
  }, []);

  return { isConnected, unsubscribe };
}

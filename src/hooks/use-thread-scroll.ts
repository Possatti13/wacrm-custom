"use client";

import { useLayoutEffect, useRef } from 'react';
import type { Message } from '@/types';

export function useThreadScroll(conversationId: string | undefined, messages: Message[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const previous = useRef<{ id?: string; last?: string; initialized: boolean }>({ initialized: false });
  const nearBottom = useRef(true);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const last = messages.at(-1)?.id;
    const changed = previous.current.id !== conversationId;
    const initial = changed || !previous.current.initialized;
    if (initial || (nearBottom.current && last !== previous.current.last)) {
      el.scrollTop = el.scrollHeight;
      nearBottom.current = true;
    }
    previous.current = { id: conversationId, last, initialized: messages.length > 0 };
  }, [conversationId, messages]);
  return { scrollRef, onScroll: () => {
    const el = scrollRef.current;
    if (el) nearBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop <= 80;
  } };
}

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setupRealtimeSubscription } from './use-realtime';
import type { createClient } from '@/lib/supabase/client';

const createdChannels: Array<{
  name: string;
  onCalls: Array<{ event: string; filter: Record<string, unknown> }>;
  subscribed: boolean;
  subscribedBeforeOn: boolean;
}> = [];

const removedChannels: string[] = [];

function createMockSupabase() {
  return {
    channel: (name: string) => {
      const channelState = {
        name,
        onCalls: [] as Array<{ event: string; filter: Record<string, unknown> }>,
        subscribed: false,
        subscribedBeforeOn: false,
      };
      createdChannels.push(channelState);

      const channelObj = {
        name,
        on: (event: string, filter: Record<string, unknown>, _callback: unknown) => {
          if (channelState.subscribed) {
            channelState.subscribedBeforeOn = true;
          }
          channelState.onCalls.push({ event, filter });
          return channelObj;
        },
        subscribe: (cb?: (status: string) => void) => {
          channelState.subscribed = true;
          cb?.('SUBSCRIBED');
          return channelObj;
        },
      };
      return channelObj;
    },
    removeChannel: (channel: { name: string }) => {
      removedChannels.push(channel.name);
      return Promise.resolve('ok');
    },
  } as unknown as ReturnType<typeof createClient>;
}

describe('Realtime Subscription Lifecycle & Isolation (REALTIME-001)', () => {
  beforeEach(() => {
    createdChannels.length = 0;
    removedChannels.length = 0;
  });

  it('1. registers all postgres_changes listeners BEFORE calling subscribe()', () => {
    const supabase = createMockSupabase();
    let statusReceived = '';

    const sub = setupRealtimeSubscription(supabase, {
      channelName: 'inbox-realtime',
      onMessageEvent: vi.fn(),
      onConversationEvent: vi.fn(),
      onStatusChange: (status) => {
        statusReceived = status;
      },
    });

    expect(createdChannels).toHaveLength(1);
    const ch = createdChannels[0];
    expect(ch.name).toContain('inbox-realtime-');
    expect(ch.onCalls.length).toBe(2);
    expect(ch.subscribed).toBe(true);
    expect(ch.subscribedBeforeOn).toBe(false);
    expect(statusReceived).toBe('SUBSCRIBED');

    sub.unsubscribe();
    expect(removedChannels).toContain(ch.name);
  });

  it('2. generates a fresh, isolated channel instance across remounts (no static name collision)', () => {
    const supabase = createMockSupabase();

    const sub1 = setupRealtimeSubscription(supabase, {
      channelName: 'inbox-realtime',
    });

    expect(createdChannels).toHaveLength(1);
    const firstChannelName = createdChannels[0].name;
    sub1.unsubscribe();

    expect(removedChannels).toContain(firstChannelName);

    // Second subscription (simulating remount)
    const sub2 = setupRealtimeSubscription(supabase, {
      channelName: 'inbox-realtime',
    });

    expect(createdChannels).toHaveLength(2);
    const secondChannelName = createdChannels[1].name;

    expect(secondChannelName).not.toBe(firstChannelName);
    expect(secondChannelName).toContain('inbox-realtime-');

    sub2.unsubscribe();
    expect(removedChannels).toContain(secondChannelName);
  });

  it('3. properly cleans up channel on unsubscribe via removeChannel', () => {
    const supabase = createMockSupabase();

    const sub = setupRealtimeSubscription(supabase, {
      channelName: 'notifications-page',
    });

    expect(createdChannels).toHaveLength(1);
    const chName = createdChannels[0].name;

    sub.unsubscribe();
    expect(removedChannels).toHaveLength(1);
    expect(removedChannels[0]).toBe(chName);
  });

  it('4. concurrent subscribers create independent isolated channels without collisions', () => {
    const supabase = createMockSupabase();

    const sub1 = setupRealtimeSubscription(supabase, {
      channelName: 'inbox-realtime',
    });

    const sub2 = setupRealtimeSubscription(supabase, {
      channelName: 'inbox-realtime',
    });

    expect(createdChannels).toHaveLength(2);
    expect(createdChannels[0].name).not.toBe(createdChannels[1].name);

    sub1.unsubscribe();
    sub2.unsubscribe();

    expect(removedChannels).toContain(createdChannels[0].name);
    expect(removedChannels).toContain(createdChannels[1].name);
  });
});

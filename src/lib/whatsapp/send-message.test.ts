/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { encrypt } from '@/lib/whatsapp/encryption';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

describe('sendMessageToConversation — Provider Routing & WhatsApp LID', () => {
  it('routes outbound message to external_chat_id when contact has no phone (WAHA provider)', async () => {
    const mockSendText = vi.fn(async () => ({
      provider: 'waha',
      externalMessageId: 'true_25190000009361@lid_OUT123',
      status: 'sent',
    }));

    const mockDb: any = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: 'conv-lid-1',
                      account_id: 'acct-1',
                      external_chat_id: '25190000009361@lid',
                      contact: {
                        id: 'contact-lid-1',
                        phone: null,
                        whatsapp_lid: '25190000009361@lid',
                        name: 'Leo Possatti',
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        }
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'wcfg-1',
                    account_id: 'acct-1',
                    provider_type: 'waha',
                    waha_base_url: 'http://localhost:3001',
                    waha_session_name: 'ciclopes_test',
                    access_token: encrypt('secret-token'),
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  not: () => ({
                    order: () => ({
                      limit: () => ({
                        maybeSingle: async () => ({ data: null }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'msg-persisted-1' },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (table === 'contacts') {
          return {
            update: () => ({
              eq: () => Promise.resolve({ data: null, error: null }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null }),
              }),
            }),
          }),
        };
      }),
    };

    // Mock factory
    const factory = await import('./providers/factory');
    vi.spyOn(factory, 'getWhatsAppProvider').mockReturnValue({
      type: 'waha',
      getCapabilities: () => ({
        sendText: true,
        sendImage: true,
        sendDocument: true,
        sendAudio: true,
        sendVideo: true,
        templates: false,
        interactiveMessages: false,
        reactions: false,
        qrCode: true,
        sessionLifecycle: true,
      }),
      sendText: mockSendText,
      sendMedia: vi.fn(),
      getStatus: vi.fn(),
    } as any);

    const result = await sendMessageToConversation(mockDb as SupabaseClient, 'acct-1', {
      conversationId: 'conv-lid-1',
      messageType: 'text',
      contentText: 'Resposta enviada para conversa @lid',
    });

    expect(result.messageId).toBe('msg-persisted-1');
    expect(result.whatsappMessageId).toBe('true_25190000009361@lid_OUT123');
    expect(mockSendText).toHaveBeenCalledWith({
      to: '25190000009361@lid',
      text: 'Resposta enviada para conversa @lid',
    });
  });

  it('rejects outbound message when contact has no phone and provider is Meta (requires E.164)', async () => {
    const mockDb: any = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: 'conv-lid-1',
                      account_id: 'acct-1',
                      external_chat_id: '25190000009361@lid',
                      contact: {
                        id: 'contact-lid-1',
                        phone: null,
                        whatsapp_lid: '25190000009361@lid',
                        name: 'Leo Possatti',
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'wcfg-1',
                    account_id: 'acct-1',
                    provider_type: 'meta',
                    phone_number_id: 'pn-123',
                    access_token: encrypt('secret-token'),
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'msg-lid-1' },
                  error: null,
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        return {};
      }),
    };

    const factory = await import('./providers/factory');
    vi.spyOn(factory, 'getWhatsAppProvider').mockReturnValue({
      type: 'meta',
      getCapabilities: () => ({
        sendText: true,
        sendImage: true,
        sendDocument: true,
        sendAudio: true,
        sendVideo: true,
        templates: true,
        interactiveMessages: true,
        reactions: true,
        qrCode: false,
        sessionLifecycle: false,
      }),
      sendText: vi.fn(),
      sendMedia: vi.fn(),
      getStatus: vi.fn(),
    } as any);

    await expect(
      sendMessageToConversation(mockDb as SupabaseClient, 'acct-1', {
        conversationId: 'conv-lid-1',
        messageType: 'text',
        contentText: 'Tentativa para Meta',
      })
    ).rejects.toMatchObject({
      code: 'bad_request',
      status: 400,
    });
  });

  it('persists sender_id from senderUserId on successful send', async () => {
    let insertedPayload: any = null;

    const mockDb: any = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: 'conv-1',
                      account_id: 'acct-1',
                      contact: {
                        id: 'contact-1',
                        phone: '5511999999999',
                        name: 'Test Contact',
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'wcfg-1',
                    account_id: 'acct-1',
                    provider_type: 'waha',
                    access_token: encrypt('secret-token'),
                    waha_api_url: 'http://waha.local',
                    waha_session_name: 'test_session',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            insert: (payload: any) => {
              insertedPayload = payload;
              return {
                select: () => ({
                  single: async () => ({
                    data: { id: 'msg-saved-1', ...payload },
                    error: null,
                  }),
                }),
              };
            },
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (table === 'flow_runs') {
          return {
            update: () => ({
              eq: () => ({
                eq: () => ({
                  eq: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const factory = await import('./providers/factory');
    vi.spyOn(factory, 'getWhatsAppProvider').mockReturnValue({
      type: 'waha',
      getCapabilities: () => ({
        sendText: true,
        sendImage: true,
        sendDocument: true,
        sendAudio: true,
        sendVideo: true,
        templates: false,
        interactiveMessages: false,
        reactions: false,
        qrCode: true,
        sessionLifecycle: true,
      }),
      sendText: vi.fn().mockResolvedValue({ messageId: 'wa-msg-1' }),
      sendMedia: vi.fn(),
      getStatus: vi.fn(),
    } as any);

    const result = await sendMessageToConversation(mockDb as SupabaseClient, 'acct-1', {
      conversationId: 'conv-1',
      messageType: 'text',
      contentText: 'Olá do operador',
      senderUserId: 'user-seller-123',
    });

    expect(result.messageId).toBe('msg-saved-1');
    expect(insertedPayload).not.toBeNull();
    expect(insertedPayload.sender_id).toBe('user-seller-123');
    expect(insertedPayload.sender_type).toBe('agent');
  });

  it('transitions message status to failed and propagates error when provider rejects', async () => {
    let updatedStatus: string | null = null;

    const mockDb: any = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: 'conv-1',
                      account_id: 'acct-1',
                      contact: {
                        id: 'contact-1',
                        phone: '5511999999999',
                        name: 'Test Contact',
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
            update: () => ({
              eq: async () => ({ data: null, error: null }),
            }),
          };
        }
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'wcfg-1',
                    account_id: 'acct-1',
                    provider_type: 'waha',
                    access_token: encrypt('secret-token'),
                    waha_api_url: 'http://waha.local',
                    waha_session_name: 'test_session',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: { id: 'msg-failing-1', status: 'sending' },
                  error: null,
                }),
              }),
            }),
            update: (payload: { status: string }) => {
              updatedStatus = payload.status;
              return {
                eq: async () => ({ data: null, error: null }),
              };
            },
          };
        }
        return {};
      }),
    };

    const factory = await import('./providers/factory');
    const mockSendText = vi.fn().mockRejectedValue(new Error('Connection timed out'));

    vi.spyOn(factory, 'getWhatsAppProvider').mockReturnValue({
      type: 'waha',
      getCapabilities: () => ({
        sendText: true,
        sendImage: true,
        sendDocument: true,
        sendAudio: true,
        sendVideo: true,
        templates: false,
        interactiveMessages: false,
        reactions: false,
        qrCode: true,
        sessionLifecycle: true,
      }),
      sendText: mockSendText,
      sendMedia: vi.fn(),
      getStatus: vi.fn(),
    } as any);

    await expect(
      sendMessageToConversation(mockDb as SupabaseClient, 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Test error handling',
      })
    ).rejects.toMatchObject({
      code: 'waha_error',
      status: 502,
    });

    expect(mockSendText).toHaveBeenCalledTimes(1);
    expect(updatedStatus).toBe('failed');
  });

  it('aborts immediately and prevents provider calls if initial DB insert fails', async () => {
    const mockSendText = vi.fn();

    const mockDb: any = {
      from: vi.fn((table: string) => {
        if (table === 'conversations') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  single: async () => ({
                    data: {
                      id: 'conv-1',
                      account_id: 'acct-1',
                      contact: {
                        id: 'contact-1',
                        phone: '5511999999999',
                        name: 'Test Contact',
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          };
        }
        if (table === 'whatsapp_config') {
          return {
            select: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'wcfg-1',
                    account_id: 'acct-1',
                    provider_type: 'waha',
                    access_token: encrypt('secret-token'),
                    waha_api_url: 'http://waha.local',
                    waha_session_name: 'test_session',
                  },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === 'messages') {
          return {
            insert: () => ({
              select: () => ({
                single: async () => ({
                  data: null,
                  error: { message: 'Database disk full or deadlocked' },
                }),
              }),
            }),
          };
        }
        return {};
      }),
    };

    const factory = await import('./providers/factory');
    vi.spyOn(factory, 'getWhatsAppProvider').mockReturnValue({
      type: 'waha',
      getCapabilities: () => ({
        sendText: true,
        sendImage: true,
        sendDocument: true,
        sendAudio: true,
        sendVideo: true,
        templates: false,
        interactiveMessages: false,
        reactions: false,
        qrCode: true,
        sessionLifecycle: true,
      }),
      sendText: mockSendText,
      sendMedia: vi.fn(),
      getStatus: vi.fn(),
    } as any);

    await expect(
      sendMessageToConversation(mockDb as SupabaseClient, 'acct-1', {
        conversationId: 'conv-1',
        messageType: 'text',
        contentText: 'Test db fail',
      })
    ).rejects.toMatchObject({
      code: 'db_error',
      status: 500,
    });

    expect(mockSendText).toHaveBeenCalledTimes(0);
  });
});



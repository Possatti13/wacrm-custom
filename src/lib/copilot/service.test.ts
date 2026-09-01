import { describe, it, expect, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { runCopilotAction, formatMessageForCopilot } from './service';

describe('Commercial Copilot Service & Context Grounding', () => {
  const accountId = '00000000-0000-0000-0000-000000000001';
  const conversationId = '00000000-0000-0000-0000-000000000010';
  const contactId = '00000000-0000-0000-0000-000000000020';

  describe('formatMessageForCopilot', () => {
    it('formats plain text customer message with speaker and timestamp', () => {
      const formatted = formatMessageForCopilot({
        id: 'm1',
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Quanto custa a Falcon 2024?',
        created_at: '2026-09-01T10:30:00Z',
      });
      expect(formatted).toContain('CLIENTE:');
      expect(formatted).toContain('Quanto custa a Falcon 2024?');
    });

    it('formats seller (agent) message correctly', () => {
      const formatted = formatMessageForCopilot({
        id: 'm2',
        sender_type: 'agent',
        content_type: 'text',
        content_text: 'Ela custa R$ 12.000.',
        created_at: '2026-09-01T10:31:00Z',
      });
      expect(formatted).toContain('VENDEDOR:');
      expect(formatted).toContain('Ela custa R$ 12.000.');
    });

    it('formats image messages with caption or placeholder', () => {
      const withCaption = formatMessageForCopilot({
        id: 'm3',
        sender_type: 'customer',
        content_type: 'image',
        content_text: 'Foto da moto preta',
        created_at: '2026-09-01T10:32:00Z',
      });
      expect(withCaption).toContain('[Imagem com legenda: "Foto da moto preta"]');

      const noCaption = formatMessageForCopilot({
        id: 'm4',
        sender_type: 'customer',
        content_type: 'image',
        content_text: null,
        created_at: '2026-09-01T10:33:00Z',
      });
      expect(noCaption).toContain('[Cliente enviou uma imagem]');
    });

    it('formats audio messages with transcript or placeholder', () => {
      const withTranscript = formatMessageForCopilot({
        id: 'm5',
        sender_type: 'customer',
        content_type: 'audio',
        content_text: 'Gostaria de saber se aceitam troca.',
        created_at: '2026-09-01T10:34:00Z',
      });
      expect(withTranscript).toContain('[Áudio transcrito: "Gostaria de saber se aceitam troca."]');

      const noTranscript = formatMessageForCopilot({
        id: 'm6',
        sender_type: 'customer',
        content_type: 'audio',
        content_text: null,
        created_at: '2026-09-01T10:35:00Z',
      });
      expect(noTranscript).toContain('[Mensagem de áudio sem transcrição disponível]');
    });

    it('sanitizes PII such as CPF from message content', () => {
      const formatted = formatMessageForCopilot({
        id: 'm7',
        sender_type: 'customer',
        content_type: 'text',
        content_text: 'Meu CPF é 123.456.789-00 para o contrato.',
        created_at: '2026-09-01T10:36:00Z',
      });
      expect(formatted).not.toContain('123.456.789-00');
      expect(formatted).toContain('[CPF_PROTEGIDO]');
    });
  });

  describe('runCopilotAction Grounding & Security', () => {
    it('blocks cross-tenant conversation access with clear error', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      } as unknown as SupabaseClient;

      await expect(
        runCopilotAction(mockDb, accountId, {
          action: 'suggest_reply',
          conversationId: 'wrong-tenant-conv-id',
          contactId,
        })
      ).rejects.toThrow('Conversa não encontrada ou não pertence a esta conta.');
    });

    it('identifies insufficient context when conversation is only a greeting', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: conversationId, account_id: accountId, contact_id: contactId },
                error: null,
              }),
            };
          }
          if (table === 'contacts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { name: 'João Silva', phone: '5511999999999' },
                error: null,
              }),
            };
          }
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'm1',
                    sender_type: 'customer',
                    content_type: 'text',
                    content_text: 'Oi',
                    created_at: '2026-09-01T10:00:00Z',
                  },
                ],
                error: null,
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      } as unknown as SupabaseClient;

      const res = await runCopilotAction(mockDb, accountId, {
        action: 'analyze_intent',
        conversationId,
        contactId,
        customPrompt: 'O que esse cliente quer?',
      });

      expect(res.confidence).toBe('low');
      expect(res.content).toContain('não há contexto suficiente');
    });

    it('grounds price objection when client mentions high price', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: conversationId, account_id: accountId, contact_id: contactId },
                error: null,
              }),
            };
          }
          if (table === 'contacts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { name: 'Carlos Mendes', phone: '5511988888888' },
                error: null,
              }),
            };
          }
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'm2',
                    sender_type: 'customer',
                    content_type: 'text',
                    content_text: 'Gostei da opção preta, mas achei R$ 12.000 muito caro.',
                    created_at: '2026-09-01T10:02:00Z',
                  },
                  {
                    id: 'm1',
                    sender_type: 'customer',
                    content_type: 'text',
                    content_text: 'Olá, bom dia!',
                    created_at: '2026-09-01T10:00:00Z',
                  },
                ],
                error: null,
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      } as unknown as SupabaseClient;

      const res = await runCopilotAction(mockDb, accountId, {
        action: 'overcome_objection',
        conversationId,
        contactId,
      });

      expect(res.content).toContain('Preço');
      expect(res.evidence).toBeDefined();
      expect(res.evidence?.length).toBeGreaterThan(0);
      expect(res.suggestedReply).toBeDefined();
    });

    it('prioritizes recent messages over old terms', async () => {
      const mockDb = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'conversations') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { id: conversationId, account_id: accountId, contact_id: contactId },
                error: null,
              }),
            };
          }
          if (table === 'contacts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { name: 'Mariana Lima', phone: '5511977777777' },
                error: null,
              }),
            };
          }
          if (table === 'messages') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: [
                  {
                    id: 'm3',
                    sender_type: 'customer',
                    content_type: 'text',
                    content_text: 'Mudei de ideia, prefiro pagar no PIX à vista se tiver desconto.',
                    created_at: '2026-09-01T10:10:00Z',
                  },
                  {
                    id: 'm2',
                    sender_type: 'agent',
                    content_type: 'text',
                    content_text: 'Temos opções em 12x no cartão.',
                    created_at: '2026-09-01T10:05:00Z',
                  },
                  {
                    id: 'm1',
                    sender_type: 'customer',
                    content_type: 'text',
                    content_text: 'Queria parcelar no cartão.',
                    created_at: '2026-09-01T10:00:00Z',
                  },
                ],
                error: null,
              }),
            };
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null }),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          };
        }),
      } as unknown as SupabaseClient;

      const res = await runCopilotAction(mockDb, accountId, {
        action: 'suggest_reply',
        conversationId,
        contactId,
        customPrompt: 'Como o cliente quer pagar?',
      });

      expect(res.content).toBeDefined();
      expect(res.evidence).toBeDefined();
    });
  });
});

import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';

export interface UnansweredConversationResult {
  conversationId: string;
  contactId: string;
  contactName: string;
  contactPhone: string;
  unreadCount: number;
  lastMessageText: string;
  lastMessageAt: string;
}

interface ConvRow {
  id: string;
  contact_id: string;
  unread_count: number;
  last_message_at: string;
  contacts?: { id: string; name: string; phone: string } | null;
  messages?: Array<{ sender_type: string; content_text: string | null }> | null;
}

export async function getUnansweredConversations(
  db: SupabaseClient,
  accountId: string,
  limit = 15
): Promise<{
  conversations: UnansweredConversationResult[];
  count: number;
}> {
  const validAccId = validateUuid(accountId, 'accountId');

  // Fetch open conversations with unread_count > 0 or where last message was from customer
  const { data: convData } = await db
    .from('conversations')
    .select(`
      id,
      contact_id,
      unread_count,
      last_message_at,
      contacts (id, name, phone),
      messages (sender_type, content_text)
    `)
    .eq('account_id', validAccId)
    .eq('status', 'open')
    .gt('unread_count', 0)
    .order('last_message_at', { ascending: false })
    .limit(limit);

  const rows = (convData || []) as unknown as ConvRow[];
  const conversations: UnansweredConversationResult[] = rows.map((c) => {
    const lastMsg = c.messages?.[0];
    return {
      conversationId: c.id,
      contactId: c.contact_id,
      contactName: c.contacts?.name || 'Cliente',
      contactPhone: c.contacts?.phone || '',
      unreadCount: c.unread_count || 0,
      lastMessageText: lastMsg?.content_text || 'Mensagem recente',
      lastMessageAt: c.last_message_at,
    };
  });

  return {
    conversations,
    count: conversations.length,
  };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';

export interface MessageMentionResult {
  messageId: string;
  conversationId: string;
  contactName: string;
  senderType: string;
  textContent: string;
  createdAt: string;
}

interface MentionRow {
  id: string;
  conversation_id: string;
  sender_type: string;
  content_text: string | null;
  created_at: string;
  conversations?: {
    account_id: string;
    contact_id: string;
    contacts?: { name: string } | null;
  } | null;
}

export async function searchMessageMentions(
  db: SupabaseClient,
  accountId: string,
  rawKeyword: string,
  limit = 20
): Promise<{
  keyword: string;
  mentions: MessageMentionResult[];
  count: number;
}> {
  const validAccId = validateUuid(accountId, 'accountId');
  const cleanKeyword = rawKeyword.trim();

  if (!cleanKeyword) {
    return { keyword: '', mentions: [], count: 0 };
  }

  const { data: messagesData } = await db
    .from('messages')
    .select(`
      id,
      conversation_id,
      sender_type,
      content_text,
      created_at,
      conversations!inner (
        account_id,
        contact_id,
        contacts (name)
      )
    `)
    .eq('conversations.account_id', validAccId)
    .ilike('content_text', `%${cleanKeyword}%`)
    .order('created_at', { ascending: false })
    .limit(limit);

  const rows = (messagesData || []) as unknown as MentionRow[];
  const mentions: MessageMentionResult[] = rows.map((m) => ({
    messageId: m.id,
    conversationId: m.conversation_id,
    contactName: m.conversations?.contacts?.name || 'Cliente',
    senderType: m.sender_type,
    textContent: m.content_text || '',
    createdAt: m.created_at,
  }));

  return {
    keyword: cleanKeyword,
    mentions,
    count: mentions.length,
  };
}

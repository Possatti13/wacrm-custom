import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';

export interface CatalogSearchContactResult {
  contactId: string;
  contactName: string;
  contactPhone: string;
  itemId: string;
  itemName: string;
  itemType: string;
  status: string;
  createdAt: string;
}

interface InterestRow {
  contact_id: string;
  catalog_item_id: string;
  status: string;
  created_at: string;
  contacts?: { id: string; name: string; phone: string } | null;
  catalog_items?: { id: string; name: string; type: string } | null;
}

export async function searchContactsByCatalogItem(
  db: SupabaseClient,
  accountId: string,
  rawTerm: string
): Promise<{
  term: string;
  resolvedItemName?: string;
  contacts: CatalogSearchContactResult[];
  count: number;
}> {
  const validAccId = validateUuid(accountId, 'accountId');
  const cleanTerm = rawTerm.trim().toLowerCase();

  // 1. Resolve matching catalog items via name or sku
  const { data: matchedItems } = await db
    .from('catalog_items')
    .select('id, name, type, sku')
    .eq('account_id', validAccId)
    .eq('status', 'active')
    .or(`name.ilike.%${cleanTerm}%,sku.ilike.%${cleanTerm}%`)
    .limit(10);

  const targetItemIds: string[] = (matchedItems || []).map((i) => i.id);
  const resolvedName = matchedItems?.[0]?.name;

  if (targetItemIds.length === 0) {
    return {
      term: rawTerm,
      contacts: [],
      count: 0,
    };
  }

  // 2. Query contact_catalog_interests for target items
  const { data: interestsData } = await db
    .from('contact_catalog_interests')
    .select(`
      contact_id,
      catalog_item_id,
      status,
      created_at,
      contacts!inner (id, name, phone),
      catalog_items!inner (id, name, type)
    `)
    .eq('account_id', validAccId)
    .in('catalog_item_id', targetItemIds)
    .order('created_at', { ascending: false })
    .limit(50);

  const rows = (interestsData || []) as unknown as InterestRow[];
  const results: CatalogSearchContactResult[] = rows.map((row) => ({
    contactId: row.contacts?.id || row.contact_id,
    contactName: row.contacts?.name || 'Cliente sem nome',
    contactPhone: row.contacts?.phone || '',
    itemId: row.catalog_items?.id || row.catalog_item_id,
    itemName: row.catalog_items?.name || 'Item',
    itemType: row.catalog_items?.type || 'product',
    status: row.status || 'active',
    createdAt: row.created_at,
  }));

  return {
    term: rawTerm,
    resolvedItemName: resolvedName,
    contacts: results,
    count: results.length,
  };
}

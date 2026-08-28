export interface WahaSessionInfo {
  name: string;
  status: 'STOPPED' | 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | string;
  me?: { id?: string; pushName?: string } | null;
}

export interface WahaConfig {
  baseUrl: string;
  apiKey: string;
  session: string;
}

export type WahaMediaKind = 'image' | 'document';

export interface WahaRawChat {
  id: string;
  name?: string;
  timestamp?: number;
  unreadCount?: number;
  isGroup?: boolean;
}

export interface GetWahaChatMessagesOptions {
  limit?: number;
  offset?: number;
  downloadMedia?: boolean;
  filterTimestampGte?: number;
  filterTimestampLte?: number;
  filterFromMe?: boolean;
}

export interface WahaRawMessage {
  id: string;
  timestamp: number;
  from: string;
  fromMe: boolean;
  to?: string;
  body?: string;
  text?: string;
  caption?: string;
  hasMedia?: boolean;
  media?: { url?: string; mimetype?: string; filename?: string };
  mediaUrl?: string;
  type?: string;
  _data?: {
    id?: { id?: string; _serialized?: string; remote?: string; fromMe?: boolean };
    notifyName?: string;
    t?: number;
    body?: string;
    type?: string;
  };
}

function cleanBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '');
}

async function wahaFetch<T>(
  config: Pick<WahaConfig, 'baseUrl' | 'apiKey'>,
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const res = await fetch(`${cleanBaseUrl(config.baseUrl)}${path}`, {
    ...init,
    headers: {
      'X-Api-Key': config.apiKey,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`WAHA ${res.status}: ${text || res.statusText}`);
  }

  const contentType = res.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return (await res.text()) as T;
  }
  return (await res.json()) as T;
}

export async function getWahaSession(
  config: WahaConfig
): Promise<WahaSessionInfo> {
  return wahaFetch<WahaSessionInfo>(
    config,
    `/api/sessions/${encodeURIComponent(config.session)}`
  );
}

export async function ensureWahaSession(config: WahaConfig): Promise<WahaSessionInfo> {
  try {
    return await getWahaSession(config);
  } catch {
    return wahaFetch<WahaSessionInfo>(config, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: config.session, start: true }),
    });
  }
}

export async function startWahaSession(config: WahaConfig): Promise<WahaSessionInfo> {
  return wahaFetch<WahaSessionInfo>(
    config,
    `/api/sessions/${encodeURIComponent(config.session)}/start`,
    { method: 'POST' }
  );
}

export async function stopWahaSession(config: WahaConfig): Promise<void> {
  await wahaFetch<unknown>(
    config,
    `/api/sessions/${encodeURIComponent(config.session)}/stop`,
    { method: 'POST' }
  );
}

export async function logoutWahaSession(config: WahaConfig): Promise<void> {
  await wahaFetch<unknown>(
    config,
    `/api/sessions/${encodeURIComponent(config.session)}/logout`,
    { method: 'POST' }
  );
}

export async function sendWahaTextMessage(
  config: WahaConfig,
  recipient: string,
  text: string
): Promise<string> {
  const chatId = recipient.includes('@')
    ? recipient
    : `${recipient.replace(/\D/g, '')}@c.us`;
  const payload = {
    session: config.session,
    chatId,
    text,
  };
  const result = await wahaFetch<unknown>(config, '/api/sendText', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const data = result as {
    id?: string;
    _data?: { id?: { id?: string; _serialized?: string } };
  };

  return (
    data._data?.id?._serialized ??
    data._data?.id?.id ??
    data.id ??
    `waha-${Date.now()}`
  );
}

function extractWahaMessageId(result: unknown): string {
  const data = result as {
    id?: string;
    _data?: { id?: { id?: string; _serialized?: string } };
  };

  return (
    data._data?.id?._serialized ??
    data._data?.id?.id ??
    data.id ??
    `waha-${Date.now()}`
  );
}

export async function sendWahaMediaMessage(
  config: WahaConfig,
  recipient: string,
  args: {
    kind: WahaMediaKind;
    mediaUrl: string;
    caption?: string | null;
    filename?: string | null;
  }
): Promise<string> {
  const chatId = recipient.includes('@')
    ? recipient
    : `${recipient.replace(/\D/g, '')}@c.us`;

  const payload = {
    session: config.session,
    chatId,
    file: {
      url: args.mediaUrl,
      filename: args.filename || undefined,
    },
    caption: args.caption || undefined,
  };

  const endpoint = args.kind === 'image' ? '/api/sendImage' : '/api/sendFile';
  const result = await wahaFetch<unknown>(config, endpoint, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  return extractWahaMessageId(result);
}

export async function configureWahaWebhook(
  config: WahaConfig,
  webhookUrl: string,
  hmacKey?: string
): Promise<void> {
  const key = hmacKey || config.apiKey || process.env.WAHA_WEBHOOK_SECRET || process.env.WAHA_API_KEY;
  await wahaFetch(config, `/api/sessions/${encodeURIComponent(config.session)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: config.session,
      config: {
        webhooks: [
          {
            url: webhookUrl,
            events: ['message.any', 'session.status', 'message.ack', 'message.reaction'],
            hmac: key ? { key } : undefined,
          },
        ],
      },
    }),
  });
}

/**
 * Lists all active chats from the WAHA engine for the session.
 */
export async function getWahaChats(
  config: WahaConfig,
  options: { limit?: number; offset?: number } = {}
): Promise<WahaRawChat[]> {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));

  const queryStr = params.toString() ? `?${params.toString()}` : '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await wahaFetch<any[]>(
    config,
    `/api/${encodeURIComponent(config.session)}/chats${queryStr}`
  );
  if (!Array.isArray(result)) return [];

  return result
    .map((raw) => {
      // WAHA WEBJS can return id as an object: { server: 'lid', user: '25190000009361', _serialized: '25190000009361@lid' }
      // or as a plain string: '5511999998888@c.us'
      const idStr =
        typeof raw.id === 'string'
          ? raw.id
          : (raw.id?._serialized ||
            (raw.id?.user && raw.id?.server ? `${raw.id.user}@${raw.id.server}` : String(raw.id || '')));

      return {
        id: idStr,
        name: raw.name || raw.pushname || raw.formattedTitle,
        timestamp:
          typeof raw.timestamp === 'number'
            ? raw.timestamp
            : (raw.lastMessage?.timestamp || raw.t),
        unreadCount:
          typeof raw.unreadCount === 'number' ? raw.unreadCount : (raw.unreadCount || 0),
        isGroup: Boolean(raw.isGroup || (idStr && idStr.endsWith('@g.us'))),
      };
    })
    .filter((c) => Boolean(c.id) && c.id !== '[object Object]');
}

/**
 * Retrieves messages for a specific chat with optional pagination and timestamp filters.
 */
export async function getWahaChatMessages(
  config: WahaConfig,
  chatId: string | { _serialized?: string; id?: string },
  options: GetWahaChatMessagesOptions = {}
): Promise<WahaRawMessage[]> {
  const chatIdStr =
    typeof chatId === 'string'
      ? chatId
      : (chatId?._serialized || (typeof chatId?.id === 'string' ? chatId.id : String(chatId || '')));

  if (!chatIdStr || chatIdStr === '[object Object]') {
    return [];
  }

  const params = new URLSearchParams();
  params.set('limit', String(options.limit ?? 50));
  if (typeof options.offset === 'number') params.set('offset', String(options.offset));
  params.set('downloadMedia', String(options.downloadMedia ?? false));
  if (typeof options.filterTimestampGte === 'number') {
    params.set('filter.timestamp.gte', String(options.filterTimestampGte));
  }
  if (typeof options.filterTimestampLte === 'number') {
    params.set('filter.timestamp.lte', String(options.filterTimestampLte));
  }
  if (typeof options.filterFromMe === 'boolean') {
    params.set('filter.fromMe', String(options.filterFromMe));
  }

  const encodedChat = encodeURIComponent(chatIdStr);
  const result = await wahaFetch<WahaRawMessage[]>(
    config,
    `/api/${encodeURIComponent(config.session)}/chats/${encodedChat}/messages?${params.toString()}`
  );
  return Array.isArray(result) ? result : [];
}

/**
 * Resolves a WhatsApp LID (e.g. "25190000009361@lid") to a real phone number via WAHA engine.
 * Returns digits-only E.164 phone string if found, or null if unresolvable.
 */
export async function resolveWahaLidToPhoneNumber(
  config: WahaConfig,
  lid: string
): Promise<string | null> {
  if (!lid || !lid.endsWith('@lid')) return null;

  try {
    const encodedLid = encodeURIComponent(lid);
    const result = await wahaFetch<{ lid?: string; pn?: string | null }>(
      config,
      `/api/${encodeURIComponent(config.session)}/lids/${encodedLid}`
    );

    if (result && result.pn) {
      // pn format is e.g. "5513974135365@c.us"
      const digits = result.pn.replace(/@.+$/, '').replace(/\D/g, '');
      return digits || null;
    }
    return null;
  } catch {
    // Non-fatal: if WAHA has not cached the LID mapping yet, return null
    return null;
  }
}


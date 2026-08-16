export interface WahaSessionInfo {
  name: string;
  status: string;
  me?: { id?: string; pushName?: string } | null;
}

export interface WahaConfig {
  baseUrl: string;
  apiKey: string;
  session: string;
}

export type WahaMediaKind = 'image' | 'document';

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

export async function ensureWahaSession(config: WahaConfig) {
  try {
    return await getWahaSession(config);
  } catch {
    return wahaFetch<WahaSessionInfo>(config, '/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ name: config.session, start: true }),
    });
  }
}

export async function startWahaSession(config: WahaConfig) {
  return wahaFetch<WahaSessionInfo>(
    config,
    `/api/sessions/${encodeURIComponent(config.session)}/start`,
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
  webhookUrl: string
): Promise<void> {
  // WAHA accepts session config updates with a webhooks array on recent
  // versions. If a local/dev version rejects it, config save still works;
  // the user can set the webhook manually or we can retry after deploy.
  await wahaFetch(config, `/api/sessions/${encodeURIComponent(config.session)}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: config.session,
      config: {
        webhooks: [
          {
            url: webhookUrl,
            events: ['message', 'message.any', 'session.status'],
          },
        ],
      },
    }),
  });
}

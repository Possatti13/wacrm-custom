export interface MessagePresentationInput {
  content_text?: string | null;
  content_type?: string | null;
}

const MEDIA_LABELS: Record<string, string> = {
  image: 'Imagem enviada',
  audio: 'Áudio enviado',
  ptt: 'Áudio enviado',
  video: 'Vídeo enviado',
  document: 'Documento enviado',
  sticker: 'Sticker enviado',
};

function isBytePayload(text: string): boolean {
  if (!/^\s*[\[{]/.test(text)) return false;
  try {
    const value = JSON.parse(text);
    const bytes =
      value?.type === 'Buffer'
        ? value.data
        : Array.isArray(value)
          ? value
          : null;
    if (
      Array.isArray(bytes) &&
      bytes.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
    ) {
      return (
        (value?.type === 'Buffer' && bytes.length >= 8) ||
        (bytes.length >= 8 &&
          ((bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) ||
            (bytes[0] === 137 &&
              bytes[1] === 80 &&
              bytes[2] === 78 &&
              bytes[3] === 71)))
      );
    }
    // Only explicit media/encoding envelopes; ordinary commercial JSON stays readable.
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      (/^(image|audio|video|application)\//i.test(
        value.mimetype ?? value.mime_type ?? ''
      ) ||
        value.encoding === 'base64')
    ) {
      return [value.data, value.payload, value.base64].some(
        (data) =>
          typeof data === 'string' &&
          (/^(\/9j\/|iVBORw0KGgo|data:.*;base64,)/i.test(data) ||
            (data.length >= 512 && isEncodedBinary(data)))
      );
    }
    return false;
  } catch {
    return false;
  }
}

function isEncodedBinary(token: string): boolean {
  // Long hex hashes and commercial identifiers are not sufficient evidence.
  if (/^[a-f\d]+$/i.test(token) || !/[a-z]/.test(token) || !/[A-Z]/.test(token))
    return false;
  try {
    // Inspect a bounded prefix; do not allocate a decoded copy of a large image.
    const prefix = token.slice(0, 512).replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(prefix);
    const nonText = Array.from(decoded).filter((c) => {
      const code = c.charCodeAt(0);
      return (code < 32 && ![9, 10, 13].includes(code)) || code > 126;
    }).length;
    return nonText / decoded.length > 0.3;
  } catch {
    return false;
  }
}

function safeText(text: string): { text: string; isTechnical: boolean } {
  if (isBytePayload(text)) return { text: '', isTechnical: true };
  let isTechnical = false;
  const remove = () => {
    isTechnical = true;
    return '';
  };
  // Keep URLs intact, including long signed/commercial tokens in their path/query.
  const cleaned = text
    .split(/(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/i)
    .map((part, index) => {
      if (index % 2) return part;
      return part
        .replace(
        /data:[\w.+-]+\/[\w.+-]+(?:;[^,;\s]*)*;base64,[a-z\d+/_=-]+/gi,
          remove
        )
        .replace(
          /(?:\/9j\/|iVBORw0KGgo|JVBERi0)[a-z\d+/=_-]{12,}(?:\.{3})?/gi,
          remove
        )
        .replace(/(?:\\x[a-f\d]{2}){8,}/gi, remove)
        .replace(
          /(?:ff\s+d8\s+ff|89\s+50\s+4e\s+47)(?:\s+[a-f\d]{2}){5,}/gi,
          remove
        )
        .replace(
          /[a-z\d+/_=-]{512,}/gi,
          (token: string, offset: number, whole: string) => {
            if (
              /(?:pedido|sku|token|c[oó]digo|hash|placa)\s*[:#=-]?\s*$/i.test(
                whole.slice(Math.max(0, offset - 40), offset)
              )
            )
              return token;
            return isEncodedBinary(token) ? remove() : token;
          }
        );
    })
    .join('');
  if (!isTechnical) return { text, isTechnical: false };
  const humanText = cleaned.trim();
  return {
    text: /^[\s.,;:]*$/.test(humanText) ? '' : humanText,
    isTechnical: true,
  };
}

/** Display projection only: never modifies the message, asset, or persisted text. */
export function getMessagePresentation(message: MessagePresentationInput) {
  const content = message.content_text ?? '';
  const safe = safeText(content);
  const marker = content
    .match(/^\[(image|audio|ptt|video|document|sticker)\]$/i)?.[1]
    ?.toLowerCase();
  const mediaLabel = MEDIA_LABELS[message.content_type ?? marker ?? ''] ?? null;
  const caption = marker ? null : safe.text || null;
  return {
    mediaLabel,
    caption,
    isTechnical: safe.isTechnical,
    text: mediaLabel
      ? mediaLabel + (caption ? ` — ${caption}` : '')
      : safe.text || (safe.isTechnical ? 'Conteúdo de mídia não exibido' : ''),
  };
}

export function isTechnicalContent(text?: string | null): boolean {
  return Boolean(text && safeText(text).isTechnical);
}

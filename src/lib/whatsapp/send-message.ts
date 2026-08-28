// ============================================================
// Outbound message send — the core that both the dashboard's
// `/api/whatsapp/send` route and the public `/api/v1/messages`
// endpoint call.
//
// Given a conversation and message params, this:
//   1. validates the params for the message type,
//   2. loads the conversation + contact + WhatsApp config,
//   3. delegates delivery to the unified WhatsAppProvider layer,
//   4. persists the message + updates the conversation,
//   5. pauses any active Flow run for the contact (agent stepped in).
//
// It is transport-agnostic and provider-agnostic.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import {
  validateInteractivePayload,
  interactivePayloadPreviewText,
  type InteractiveMessagePayload,
} from '@/lib/whatsapp/interactive';
import { decrypt, encrypt, isLegacyFormat } from '@/lib/whatsapp/encryption';
import { supabaseAdmin } from '@/lib/flows/admin-client';
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils';
import type { MessageTemplate } from '@/types';
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard';
import {
  getWhatsAppProvider,
  type WhatsAppAccountConfig,
} from './providers/factory';
import {
  isTemplateCapable,
  isInteractiveCapable,
  type MediaKind,
} from './providers/types';

export const MEDIA_KINDS = ['image', 'video', 'document', 'audio'] as const;
export const VALID_MESSAGE_TYPES = [
  'text',
  'template',
  'interactive',
  ...MEDIA_KINDS,
] as const;

/**
 * Typed failure with a machine `code` and a suggested HTTP `status`.
 * Callers map it to their own response shape (`toErrorResponse` for
 * the dashboard route, the v1 envelope for the public endpoint).
 */
export class SendMessageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, message: string, status: number) {
    super(message);
    this.name = 'SendMessageError';
    this.code = code;
    this.status = status;
  }
}

export interface SendMessageParams {
  conversationId: string;
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  filename?: string | null;
  templateName?: string | null;
  templateLanguage?: string | null;
  /** Legacy positional body params (only used if messageParams.body unset). */
  templateParams?: string[];
  /** Structured template params (header/body/buttons). */
  templateMessageParams?: unknown;
  /** Structured payload for `messageType === 'interactive'`. */
  interactivePayload?: InteractiveMessagePayload | null;
  replyToMessageId?: string | null;
}

export interface SendMessageResult {
  /** Our `messages.id` (the persisted row). */
  messageId: string;
  /** Provider's message ID for the delivered message. */
  whatsappMessageId: string;
}

/**
 * Validate the message-shape params (type, required content, caption
 * cap) independently of any DB state, throwing `SendMessageError` on a
 * bad payload.
 */
export function validateSendMessageParams(params: {
  messageType: string;
  contentText?: string | null;
  mediaUrl?: string | null;
  templateName?: string | null;
  interactivePayload?: InteractiveMessagePayload | null;
}): void {
  const { messageType, contentText, mediaUrl, templateName, interactivePayload } =
    params;

  if (!messageType) {
    throw new SendMessageError(
      'bad_request',
      'message_type is required',
      400
    );
  }

  if (
    !VALID_MESSAGE_TYPES.includes(
      messageType as (typeof VALID_MESSAGE_TYPES)[number]
    )
  ) {
    throw new SendMessageError(
      'bad_request',
      `Unsupported message_type "${messageType}". Must be one of: ${VALID_MESSAGE_TYPES.join(', ')}`,
      400
    );
  }

  if (messageType === 'text') {
    if (!contentText || !contentText.trim()) {
      throw new SendMessageError(
        'bad_request',
        'content_text is required for text messages',
        400
      );
    }
  }

  const isMediaKind = MEDIA_KINDS.includes(
    messageType as (typeof MEDIA_KINDS)[number]
  );
  if (isMediaKind) {
    if (!mediaUrl) {
      throw new SendMessageError(
        'bad_request',
        'media_url is required for media messages',
        400
      );
    }
    if (messageType !== 'audio' && contentText && contentText.length > 1024) {
      throw new SendMessageError(
        'bad_request',
        `Media caption exceeds the 1024-character limit (got ${contentText.length})`,
        400
      );
    }
  }

  if (messageType === 'template') {
    if (!templateName) {
      throw new SendMessageError(
        'bad_request',
        'template_name is required for template messages',
        400
      );
    }
  }

  if (messageType === 'interactive') {
    if (!interactivePayload) {
      throw new SendMessageError(
        'bad_request',
        'interactive_payload is required for interactive messages',
        400
      );
    }
    const validation = validateInteractivePayload(interactivePayload);
    if (!validation.ok) {
      throw new SendMessageError(
        'bad_request',
        `Invalid interactive_payload: ${validation.error}`,
        400
      );
    }
  }
}

/**
 * Send a message in an existing conversation and persist it.
 */
export async function sendMessageToConversation(
  db: SupabaseClient,
  accountId: string,
  params: SendMessageParams
): Promise<SendMessageResult> {
  const {
    conversationId,
    messageType,
    contentText,
    mediaUrl,
    filename,
    templateName,
    templateLanguage,
    templateParams,
    templateMessageParams,
    interactivePayload,
    replyToMessageId,
  } = params;

  if (!conversationId) {
    throw new SendMessageError(
      'bad_request',
      'conversation_id is required',
      400
    );
  }

  validateSendMessageParams({
    messageType,
    contentText,
    mediaUrl,
    templateName,
    interactivePayload,
  });

  const isMediaKind = MEDIA_KINDS.includes(
    messageType as (typeof MEDIA_KINDS)[number]
  );

  // Load conversation + contact, scoped to account.
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();

  if (convError || !conversation) {
    throw new SendMessageError('not_found', 'Conversation not found', 404);
  }

  const contact = conversation.contact;
  const externalChatId: string | null =
    conversation.external_chat_id || contact?.whatsapp_lid || null;
  const rawPhone: string | null = contact?.phone || null;
  const sanitizedPhone = rawPhone ? sanitizePhoneForMeta(rawPhone) : null;

  // WhatsApp config, account-scoped.
  const { data: config, error: configError } = await db
    .from('whatsapp_config')
    .select('*')
    .eq('account_id', accountId)
    .single();

  if (configError || !config) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp not configured. Please set up your WhatsApp integration first.',
      400
    );
  }

  const encryptedToken = config.access_token as string | null | undefined;
  if (!encryptedToken) {
    throw new SendMessageError(
      'whatsapp_not_configured',
      'WhatsApp provider token/API key is missing. Please reconnect WhatsApp in Settings.',
      400
    );
  }

  const accessToken = decrypt(encryptedToken);

  // Self-heal legacy CBC ciphertexts. Fire-and-forget; idempotent.
  if (isLegacyFormat(encryptedToken)) {
    void db
      .from('whatsapp_config')
      .update({ access_token: encrypt(accessToken) })
      .eq('id', config.id)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] access_token GCM upgrade failed:',
            error.message
          );
        }
      });
  }

  // Resolve WhatsAppProvider instance via Factory
  const accountConfig: WhatsAppAccountConfig = {
    provider: config.provider,
    phone_number_id: config.phone_number_id,
    waba_id: config.waba_id,
    waha_base_url: config.waha_base_url,
    waha_session_name: config.waha_session_name,
    decrypted_access_token: accessToken,
  };

  const whatsappProvider = getWhatsAppProvider(accountConfig);

  // Validate capabilities
  if (messageType === 'template' && !isTemplateCapable(whatsappProvider)) {
    throw new SendMessageError(
      'unsupported_provider_message_type',
      'Templates are not supported by the current WhatsApp provider.',
      400
    );
  }

  if (messageType === 'interactive' && !isInteractiveCapable(whatsappProvider)) {
    throw new SendMessageError(
      'unsupported_provider_message_type',
      'Interactive messages are not supported by the current WhatsApp provider.',
      400
    );
  }

  // Template row lookup (for Meta templates)
  let templateRow: MessageTemplate | null = null;
  if (messageType === 'template' && templateName) {
    const { data } = await db
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', templateName)
      .eq('language', templateLanguage || 'en_US')
      .maybeSingle();

    if (data && !isMessageTemplate(data)) {
      throw new SendMessageError(
        'template_malformed',
        'Template row is malformed locally — run "Sync from Meta" in Settings to repair it.',
        500
      );
    }
    templateRow = data ?? null;
  }

  const attemptSend = async (targetPhone: string): Promise<string> => {
    if (messageType === 'template') {
      const p = whatsappProvider as unknown as {
        sendTemplate: (opts: unknown) => Promise<{ externalMessageId: string }>;
      };
      const res = await p.sendTemplate({
        to: targetPhone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        bodyParams: templateParams || [],
      });
      return res.externalMessageId;
    }

    if (isMediaKind) {
      const res = await whatsappProvider.sendMedia({
        to: targetPhone,
        mediaType: messageType as MediaKind,
        mediaUrl: mediaUrl!,
        caption: contentText || undefined,
        fileName: filename || undefined,
      });
      return res.externalMessageId;
    }

    if (messageType === 'interactive') {
      const p = interactivePayload!;
      const interactiveProv = whatsappProvider as unknown as {
        sendInteractive: (opts: unknown) => Promise<{ externalMessageId: string }>;
      };
      const res = await interactiveProv.sendInteractive({
        to: targetPhone,
        type: p.kind === 'buttons' ? 'button' : 'list',
        bodyText: p.body,
        buttons: p.kind === 'buttons' ? p.buttons : undefined,
        sections: p.kind === 'list' ? p.sections : undefined,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
      });
      return res.externalMessageId;
    }

    const res = await whatsappProvider.sendText({
      to: targetPhone,
      text: contentText!,
    });
    return res.externalMessageId;
  };

  let waMessageId = '';
  let workingPhone = sanitizedPhone;

  if (whatsappProvider.type === 'waha') {
    // WAHA direct recipient format (prefers canonical external_chat_id / @lid)
    let wahaRecipient: string | null =
      externalChatId || (sanitizedPhone ? `${sanitizedPhone}@c.us` : null);

    if (!wahaRecipient) {
      try {
        const { data: lastInbound } = await db
          .from('messages')
          .select('message_id')
          .eq('conversation_id', conversationId)
          .eq('sender_type', 'customer')
          .not('message_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        const rawMessageId = lastInbound?.message_id as string | null | undefined;
        const match = rawMessageId?.match(/^(?:true|false)_([^_]+)_.+$/);
        if (match?.[1]?.includes('@')) {
          wahaRecipient = match[1];
        }
      } catch (err) {
        console.warn('[send-message] Could not resolve WAHA chat id:', err);
      }
    }

    if (!wahaRecipient) {
      throw new SendMessageError(
        'bad_request',
        'No valid recipient phone number or WhatsApp chat identifier found for this conversation',
        400
      );
    }

    try {
      waMessageId = await attemptSend(wahaRecipient);
      workingPhone = sanitizedPhone || wahaRecipient;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown WAHA error';
      console.error('[send-message] WAHA send failed:', message);
      throw new SendMessageError('waha_error', `WAHA API error: ${message}`, 502);
    }
  } else {
    // Meta requires a valid E.164 phone
    if (!sanitizedPhone || !isValidE164(sanitizedPhone)) {
      throw new SendMessageError(
        'bad_request',
        `Valid E.164 contact phone number is required for Meta WhatsApp provider (got: "${rawPhone ?? 'none'}").`,
        400
      );
    }

    // Meta variant retry
    try {
      const variants = phoneVariants(sanitizedPhone);
      let lastError: unknown = null;

      for (const phoneToTry of variants) {
        try {
          waMessageId = await attemptSend(phoneToTry);
          workingPhone = phoneToTry;
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          const msg = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(msg)) {
            throw err;
          }
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[send-message] Meta send failed:', message);
      throw new SendMessageError('meta_api_error', `Meta API error: ${message}`, 502);
    }
  }

  // Persist working phone back to contact if different
  if (workingPhone && workingPhone !== sanitizedPhone && isValidE164(workingPhone)) {
    void db
      .from('contacts')
      .update({ phone: workingPhone })
      .eq('id', contact.id)
      .eq('account_id', accountId)
      .then(({ error }: { error: { message: string } | null }) => {
        if (error) {
          console.warn(
            '[send-message] failed to persist working phone variant to contact:',
            error.message
          );
        }
      });
  }

  // Save the sent message
  const displayText =
    messageType === 'interactive' && interactivePayload
      ? interactivePayloadPreviewText(interactivePayload)
      : contentText ?? null;

  const { data: messageRecord, error: msgError } = await db
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: messageType,
      content_text: displayText,
      media_url: mediaUrl || null,
      template_name: templateName || null,
      message_id: waMessageId,
      source_provider: whatsappProvider.type,
      status: 'sent',
      reply_to_message_id: replyToMessageId || null,
    })
    .select()
    .single();

  if (msgError) {
    console.error('[send-message] error inserting sent message:', msgError);
    throw new SendMessageError(
      'db_error',
      `Message sent via WhatsApp but failed to save to DB: ${msgError.message}`,
      500
    );
  }

  // Update conversation
  const preview =
    messageType === 'interactive' && interactivePayload
      ? interactivePayloadPreviewText(interactivePayload)
      : contentText || (templateName ? `Template: ${templateName}` : `[${messageType}]`);

  await db
    .from('conversations')
    .update({
      last_message_text: preview,
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId);

  // Pause active flow run if agent steps in
  try {
    const admin = supabaseAdmin();
    const { data: activeRuns } = await admin
      .from('flow_runs')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contact.id)
      .eq('status', 'running');

    if (activeRuns && activeRuns.length > 0) {
      const runIds = activeRuns.map((r: { id: string }) => r.id);
      await admin
        .from('flow_runs')
        .update({
          status: 'paused',
          updated_at: new Date().toISOString(),
        })
        .in('id', runIds);
    }
  } catch (err) {
    console.error('[send-message] error pausing flow runs:', err);
  }

  return {
    messageId: messageRecord.id,
    whatsappMessageId: waMessageId,
  };
}

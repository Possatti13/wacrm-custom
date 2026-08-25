import type { SupabaseClient } from '@supabase/supabase-js';
import type { CopilotRequest, CopilotResponse } from './types';
import { getCommercialContext } from '@/lib/leads/repository';
import { getTenantIntelligenceSettings } from '@/lib/intelligence/settings';
import { loadIntelligenceCredential } from '@/lib/intelligence/credentials';
import { generateReply } from '@/lib/ai/generate';
import type { ChatMessage, AiProvider } from '@/lib/ai/types';
import type { ContactCatalogInterestWithItem, ContactObjection } from '@/lib/leads/types';

export async function runCopilotAction(
  db: SupabaseClient,
  accountId: string,
  req: CopilotRequest
): Promise<CopilotResponse> {
  // 1. Load conversation messages
  const { data: messagesData } = await db
    .from('messages')
    .select('id, sender_type, text_content, created_at')
    .eq('account_id', accountId)
    .eq('conversation_id', req.conversationId)
    .order('created_at', { ascending: false })
    .limit(20);

  const recentMessages = (messagesData || []).reverse();

  // 2. Load contact commercial context
  let commercialContext = null;
  if (req.contactId) {
    commercialContext = await getCommercialContext(db, accountId, req.contactId).catch(() => null);
  }

  // 3. Load active catalog items
  const { data: catalogData } = await db
    .from('catalog_items')
    .select('id, name, type, sku, status, custom_attributes')
    .eq('account_id', accountId)
    .eq('status', 'active')
    .limit(25);

  const catalogItems = catalogData || [];

  // 4. Load AI Settings & Credential
  const intelSettings = await getTenantIntelligenceSettings(db, accountId).catch(() => null);
  const targetProvider = (intelSettings?.provider || 'openai') as 'openai' | 'anthropic' | 'xai' | 'mock';
  const targetModel = intelSettings?.model || 'gpt-4o-mini';

  const credential = await loadIntelligenceCredential(db, accountId, targetProvider).catch(() => null);

  const formattedHistory: ChatMessage[] = recentMessages.map((m) => ({
    role: m.sender_type === 'customer' ? 'user' : 'assistant',
    content: m.text_content || '',
  }));

  const profileSummary = commercialContext?.profile?.summary || 'Nenhum resumo anterior';
  const currentIntent = commercialContext?.profile?.current_intent || 'Não determinado';
  const urgency = commercialContext?.profile?.urgency || 'Normal';
  const interests = (commercialContext?.interests || [])
    .map((i: ContactCatalogInterestWithItem) => i.item?.name || 'Item')
    .join(', ') || 'Nenhum item específico identificado';
  const openObjections = (commercialContext?.objections || [])
    .filter((o: ContactObjection) => o.status === 'open')
    .map((o: ContactObjection) => o.objection)
    .join('; ') || 'Nenhuma objeção em aberto';

  const catalogSummary = catalogItems
    .map((c) => `- ${c.name} (${c.type})`)
    .join('\n');

  let systemPrompt = '';
  let userInstruction = '';

  const tone = req.tone || 'consultative';

  switch (req.action) {
    case 'summarize':
      systemPrompt = `Você é um Copiloto Comercial de CRM de elite.
Sua missão é resumir com máxima clareza o perfil do lead, seu momento de compra, interesses e objeções.
Contexto do Lead:
- Intenção: ${currentIntent}
- Urgência: ${urgency}
- Interesses: ${interests}
- Objeções Ativas: ${openObjections}
- Resumo Prévio: ${profileSummary}

Gere um resumo estruturado em tópicos:
1. 🎯 Perfil e Intenção do Cliente
2. 💡 Produtos/Serviços de Interesse
3. ⚠️ Objeções e Pontos de Atenção
4. 🚀 Próximo Passo Recomendado`;
      userInstruction = 'Por favor, resuma a situação deste cliente com base no histórico recente e no contexto comercial.';
      break;

    case 'suggest_reply':
      systemPrompt = `Você é um Copiloto Comercial de Vendas no WhatsApp.
Seu objetivo é sugerir uma resposta ideal para o atendente enviar ao cliente agora.
Tom de voz: ${tone} (natural, focado em conversão e sem enrolação).
Contexto Comercial:
- Interesses: ${interests}
- Objeções: ${openObjections}
- Itens do Catálogo Disponíveis:
${catalogSummary}

Diretrizes:
- Responda à última mensagem do cliente com precisão e empatia.
- Contorne eventuais dúvidas ou objeções com naturalidade.
- Termine com uma pergunta aberta clara para avançar a negociação.`;
      userInstruction = req.customPrompt || 'Sugira a melhor resposta comercial para a última mensagem do cliente.';
      break;

    case 'overcome_objection':
      systemPrompt = `Você é um especialista em negociação e contorno de objeções em vendas consultivas.
Objeções Ativas do Cliente: ${openObjections}
Itens de Interesse: ${interests}
Catálogo da Empresa:
${catalogSummary}

Gere:
1. Análise da raiz da objeção
2. 2 opções táticas de resposta que o atendente pode enviar para destravar a negociação`;
      userInstruction = 'Analise as objeções deste cliente e forneça estratégias práticas para contorná-las.';
      break;

    case 'match_catalog':
      systemPrompt = `Você é um consultor especialista no catálogo de produtos e serviços.
Catálogo Disponível:
${catalogSummary}
Preferências do Cliente:
- Interesses: ${interests}
- Objeções: ${openObjections}

Identifique as melhores opções do catálogo que atendem ao cliente e explique o porquê da recomendação.`;
      userInstruction = 'Compare as necessidades do cliente com os itens do catálogo e recomende a melhor opção.';
      break;
  }

  // If no AI credentials configured, return a high-quality deterministic template response
  if (!credential || !credential.apiKey || targetProvider === 'mock') {
    let fallbackText = '';
    if (req.action === 'summarize') {
      fallbackText = `🎯 **Perfil do Cliente:**\n- Intenção: ${currentIntent}\n- Urgência: ${urgency}\n- Interesses: ${interests}\n- Objeções: ${openObjections}\n\n🚀 **Próximo Passo:** Dar sequência ao atendimento apresentando as condições comerciais para os itens de interesse.`;
    } else if (req.action === 'suggest_reply') {
      fallbackText = `Olá! Tudo bem? Entendi perfeitamente o que você procura em relação a ${interests || 'nossas opções'}. Temos ótimas condições disponíveis agora. Qual seria o melhor dia para você conhecer ou receber a simulação detalhada?`;
    } else if (req.action === 'overcome_objection') {
      fallbackText = `💡 **Sugestão de Contorno de Objeção:**\n\n"Compreendo totalmente sua preocupação com ${openObjections || 'as condições atuais'}. Nós temos opções flexíveis e prazos diferenciados justamente para viabilizar isso com segurança. O que acha de vermos uma proposta personalizada sem compromisso?"`;
    } else {
      fallbackText = `Itens recomendados do catálogo para este perfil:\n${catalogSummary || 'Consulte o catálogo da empresa para mais detalhes.'}`;
    }

    return {
      action: req.action,
      content: fallbackText,
      suggestedAction: commercialContext?.profile?.next_action || undefined,
    };
  }

  // Call Provider via generateReply
  const result = await generateReply({
    config: {
      provider: targetProvider as AiProvider,
      apiKey: credential.apiKey,
      embeddingsApiKey: null,
      model: targetModel,
      systemPrompt,
      isActive: true,
      autoReplyEnabled: false,
      autoReplyMaxPerConversation: 1,
      handoffAgentId: null,
    },
    systemPrompt,
    messages: [
      ...formattedHistory,
      { role: 'user', content: userInstruction },
    ],
  });

  return {
    action: req.action,
    content: result.text,
    suggestedAction: commercialContext?.profile?.next_action || undefined,
  };
}

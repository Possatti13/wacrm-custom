import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateCategory = 'essential' | 'agency' | 'sales' | 'support'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | 'wave_services_menu'
  | 'wave_site_lead'
  | 'wave_traffic_lead'
  | 'wave_social_media_lead'
  | 'wave_automation_lead'
  | 'wave_budget_hot_lead'
  | 'wave_portfolio_request'
  | 'wave_meeting_request'
  | 'human_handoff'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  category: TemplateCategory
  businessGoal: string
  recommendedFor: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

const assignToTeam: TemplateStepSeed = {
  step_type: 'assign_conversation',
  step_config: { mode: 'round_robin' },
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Boas-vindas automática',
    description: 'Recebe novos contatos e explica o próximo passo sem deixar o lead esperando.',
    category: 'essential',
    businessGoal: 'Responder rápido e criar uma primeira impressão profissional.',
    recommendedFor: 'Todo negócio que recebe leads pelo WhatsApp.',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Olá! Seja bem-vindo(a) 👋\n\nRecebemos sua mensagem. Para te direcionar melhor, me conta rapidamente o que você procura hoje?',
        },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Fora do horário',
    description: 'Responde fora do expediente e reduz a sensação de abandono.',
    category: 'essential',
    businessGoal: 'Manter atendimento profissional mesmo quando a equipe não está online.',
    recommendedFor: 'Negócios com horário comercial definido.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Obrigado pela mensagem! No momento estamos fora do horário de atendimento.\n\nNosso horário é de segunda a sexta, das 9h às 18h. Assim que retornarmos, alguém da equipe vai te responder.',
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Qualificador de lead',
    description: 'Identifica interesse por preço/orçamento e faz perguntas iniciais de qualificação.',
    category: 'sales',
    businessGoal: 'Separar curioso de oportunidade real.',
    recommendedFor: 'Serviços, vendas consultivas e negócios com orçamento.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['preço', 'preco', 'valor', 'orçamento', 'orcamento', 'quanto custa', 'comprar'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Claro! Para te passar uma direção mais assertiva, me responde rapidinho:\n\n1. Qual solução você procura?\n2. É para você ou para sua empresa?\n3. Tem prazo para começar?\n4. Já tem alguma referência ou material?',
        },
      },
      assignToTeam,
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Follow-up 24h',
    description: 'Retoma o contato se o lead esfriar depois da primeira conversa.',
    category: 'sales',
    businessGoal: 'Recuperar oportunidades que ficariam esquecidas.',
    recommendedFor: 'Vendas consultivas e propostas comerciais.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Oi! Passando só para saber se você conseguiu ver minha mensagem anterior 😊\n\nSe ainda fizer sentido, posso te ajudar a avançar com os próximos passos.',
        },
      },
    ],
  },
  wave_services_menu: {
    slug: 'wave_services_menu',
    name: 'Menu inicial — Agência Wave',
    description: 'Mostra as principais ofertas da agência e ajuda o lead a se auto-segmentar.',
    category: 'agency',
    businessGoal: 'Direcionar rapidamente o lead para o serviço certo.',
    recommendedFor: 'Wave e agências de marketing/design.',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Olá! Seja bem-vindo(a) à Wave Digital 👋\n\nPara te direcionar melhor, qual dessas opções combina mais com o que você procura?\n\n1. Criar ou melhorar meu site\n2. Gestão de redes sociais\n3. Tráfego pago\n4. Identidade visual/design\n5. Automação de WhatsApp/IA\n6. Quero falar com alguém da equipe',
        },
      },
    ],
  },
  wave_site_lead: {
    slug: 'wave_site_lead',
    name: 'Lead de site/landing page',
    description: 'Detecta interesse por site e faz briefing inicial.',
    category: 'agency',
    businessGoal: 'Qualificar projetos de site antes da conversa humana.',
    recommendedFor: 'Agências que vendem sites, landing pages e e-commerce.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['site', 'landing page', 'pagina', 'página', 'ecommerce', 'loja virtual', 'webdesign'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Legal! Para entender melhor seu projeto de site, me responde:\n\n1. Você já tem um site hoje?\n2. O objetivo é vender, captar leads ou apresentar a empresa?\n3. Você já tem identidade visual e textos?\n4. Tem alguma referência de site que gosta?',
        },
      },
      assignToTeam,
    ],
  },
  wave_traffic_lead: {
    slug: 'wave_traffic_lead',
    name: 'Lead de tráfego pago',
    description: 'Detecta interesse em anúncios e levanta dados mínimos para diagnóstico.',
    category: 'agency',
    businessGoal: 'Qualificar demanda de Google/Meta Ads sem entrevista manual inicial.',
    recommendedFor: 'Agências que vendem mídia paga.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['tráfego', 'trafego', 'anuncio', 'anúncio', 'google ads', 'meta ads', 'facebook ads', 'instagram ads', 'leads'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Perfeito. Para avaliar uma estratégia de tráfego pago, me conta:\n\n1. Qual produto ou serviço você vende?\n2. Você já anuncia hoje?\n3. Qual investimento mensal aproximado em anúncios?\n4. Seu objetivo é leads, vendas ou reconhecimento?',
        },
      },
      assignToTeam,
    ],
  },
  wave_social_media_lead: {
    slug: 'wave_social_media_lead',
    name: 'Lead de redes sociais',
    description: 'Detecta demanda de social media e coleta contexto do perfil.',
    category: 'agency',
    businessGoal: 'Entender volume, estratégia e maturidade do cliente em conteúdo.',
    recommendedFor: 'Agências de conteúdo, social media e branding.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['instagram', 'social media', 'redes sociais', 'post', 'conteudo', 'conteúdo', 'reels'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Show! Para redes sociais, me conta:\n\n1. Qual é o @ da sua empresa?\n2. Você precisa só de posts ou também estratégia?\n3. Quantos conteúdos por semana imagina?\n4. Já tem identidade visual definida?',
        },
      },
      assignToTeam,
    ],
  },
  wave_automation_lead: {
    slug: 'wave_automation_lead',
    name: 'Lead de automação/IA',
    description: 'Detecta interesse no produto de automações WhatsApp/CRM/IA.',
    category: 'agency',
    businessGoal: 'Captar demanda para o novo serviço de CRM WhatsApp automatizado.',
    recommendedFor: 'Wave e negócios que vendem automação como serviço.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['whatsapp', 'automação', 'automacao', 'crm', 'bot', 'ia', 'atendimento automático', 'resposta automática'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Sim, trabalhamos com automações para WhatsApp e atendimento 👋\n\nA ideia é organizar seus contatos, responder leads mais rápido e automatizar etapas como boas-vindas, qualificação, follow-up e envio de materiais.\n\nHoje você atende pelo WhatsApp pessoal, Business ou equipe?',
        },
      },
      assignToTeam,
    ],
  },
  wave_budget_hot_lead: {
    slug: 'wave_budget_hot_lead',
    name: 'Lead quente — orçamento',
    description: 'Quando alguém fala em preço/orçamento, prioriza a conversa e pede dados essenciais.',
    category: 'sales',
    businessGoal: 'Aumentar velocidade de resposta para oportunidades com intenção de compra.',
    recommendedFor: 'Qualquer serviço consultivo.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['orçamento', 'orcamento', 'preço', 'preco', 'valor', 'proposta', 'contratar', 'quanto custa'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Claro! Para montar uma proposta mais assertiva, me envia essas informações:\n\n1. Qual serviço você procura?\n2. Qual é o nome da sua empresa?\n3. Você tem prazo para começar?\n4. Tem algum material, site ou referência?',
        },
      },
      assignToTeam,
    ],
  },
  wave_portfolio_request: {
    slug: 'wave_portfolio_request',
    name: 'Pedido de portfólio/cases',
    description: 'Responde quando o lead pede exemplos, trabalhos ou cases.',
    category: 'agency',
    businessGoal: 'Aproveitar interesse e direcionar para prova social.',
    recommendedFor: 'Agências, designers, produtoras e consultores.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['portfolio', 'portfólio', 'trabalhos', 'cases', 'exemplos', 'referências', 'referencias'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Claro! Posso te enviar alguns exemplos de trabalhos e cases da Wave.\n\nEnquanto isso, me conta qual tipo de projeto você quer ver como referência: site, social media, identidade visual ou automação?',
        },
      },
      assignToTeam,
    ],
  },
  wave_meeting_request: {
    slug: 'wave_meeting_request',
    name: 'Pedido de reunião',
    description: 'Detecta intenção de call/reunião e encaminha para agendamento.',
    category: 'sales',
    businessGoal: 'Transformar intenção em próximo passo claro.',
    recommendedFor: 'Vendas consultivas e diagnósticos.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['reunião', 'reuniao', 'call', 'conversa', 'agendar', 'agenda', 'diagnóstico', 'diagnostico'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            'Perfeito. Podemos agendar uma conversa para entender seu cenário e próximos passos.\n\nMe diga dois horários bons para você ou envie seu melhor período do dia.',
        },
      },
      assignToTeam,
    ],
  },
  human_handoff: {
    slug: 'human_handoff',
    name: 'Chamar atendimento humano',
    description: 'Quando o cliente pede humano/vendedor, direciona sem insistir no bot.',
    category: 'support',
    businessGoal: 'Evitar atrito e entregar a conversa para uma pessoa quando necessário.',
    recommendedFor: 'Todos os negócios com automações ativas.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['humano', 'atendente', 'vendedor', 'consultor', 'falar com alguém', 'falar com alguem'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: 'Claro. Vou direcionar sua conversa para alguém da equipe te atender melhor.',
        },
      },
      assignToTeam,
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}

export const TEMPLATE_GROUPS: Array<{
  category: TemplateCategory
  title: string
  description: string
  templates: TemplateSlug[]
}> = [
  {
    category: 'essential',
    title: 'Essenciais para qualquer cliente',
    description: 'Comece por aqui para todo projeto novo.',
    templates: ['welcome_message', 'out_of_office'],
  },
  {
    category: 'agency',
    title: 'Playbook Wave / Agência',
    description: 'Modelos prontos para marketing, sites, tráfego, conteúdo e automação.',
    templates: [
      'wave_services_menu',
      'wave_site_lead',
      'wave_traffic_lead',
      'wave_social_media_lead',
      'wave_automation_lead',
      'wave_portfolio_request',
    ],
  },
  {
    category: 'sales',
    title: 'Vendas e follow-up',
    description: 'Captura intenção comercial e recupera leads que esfriam.',
    templates: ['lead_qualifier', 'wave_budget_hot_lead', 'wave_meeting_request', 'follow_up_reminder'],
  },
  {
    category: 'support',
    title: 'Atendimento humano',
    description: 'Evita atrito quando o cliente quer falar com alguém.',
    templates: ['human_handoff'],
  },
]

export type AutomationPlaybookSlug = 'essentials' | 'wave_agency'

export const AUTOMATION_PLAYBOOKS: Record<AutomationPlaybookSlug, {
  slug: AutomationPlaybookSlug
  name: string
  description: string
  recommendedFor: string
  templates: TemplateSlug[]
}> = {
  essentials: {
    slug: 'essentials',
    name: 'Essencial para qualquer negócio',
    description: 'Instala o mínimo profissional: boas-vindas, fora do horário, orçamento, follow-up e humano.',
    recommendedFor: 'Primeiro setup de qualquer cliente novo.',
    templates: [
      'welcome_message',
      'out_of_office',
      'lead_qualifier',
      'follow_up_reminder',
      'human_handoff',
    ],
  },
  wave_agency: {
    slug: 'wave_agency',
    name: 'Wave / Agência de marketing',
    description: 'Instala o pacote base para captar e qualificar leads de site, tráfego, social media, automação, portfólio, reunião e orçamento.',
    recommendedFor: 'Wave e agências de marketing/design que vendem serviços consultivos.',
    templates: [
      'wave_services_menu',
      'out_of_office',
      'wave_site_lead',
      'wave_traffic_lead',
      'wave_social_media_lead',
      'wave_automation_lead',
      'wave_budget_hot_lead',
      'wave_portfolio_request',
      'wave_meeting_request',
      'follow_up_reminder',
      'human_handoff',
    ],
  },
}


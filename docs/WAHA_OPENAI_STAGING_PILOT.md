# Guia do Piloto em Staging: WhatsApp (WAHA / Meta) + OpenAI On-Demand Intelligence

> **Ambiente Autorizado**: STAGING (`crm-whatsapp-staging` / `pxpnkaakurjwpfuezpob`)  
> **Ambiente PROIBIDO**: PRODUÇÃO (`crm-whatsapp` / `vutyeaytyksciiykddyh` — STRICTLY UNTOUCHED)  
> **Versão Canônica do Schema**: Migrations `001` → `062`

---

## 1. Princípio Arquitetural Central: "Internal AI + On-Demand"

> **"Sua equipe conversa. A inteligência administra."**

O CRM não expõe um chatbot para falar diretamente com o cliente final nem processa LLM para cada mensagem recebida.

### A Regra de Ouro Econômica
$$\text{10.000 mensagens recebidas} \neq \text{10.000 chamadas de LLM}$$

* **Mensagens recebidas em modo `on_demand` (padrão)**: Armazenadas no banco sem acionar jobs de IA $\to$ **0 chamadas de LLM**.
* **Ações disparadas sob demanda pela equipe**: Resumo, Objeções, Sugestão de Próximo Passo, etc. $\to$ **1 chamada de LLM**.
* **Cliques subsequentes com mesmo estado da conversa**: Resolução via cache criptográfico SHA-256 $\to$ **0 chamadas de LLM**.
* **Perguntas factuais sobre dados do CRM** (Ex: "Quem perguntou da Falcon?", "Quais tarefas estão atrasadas?"): Resolução 100% determinística via SQL allowlisted $\to$ **0 chamadas de LLM**.

---

## 2. Checklist de Configuração do Piloto

### A. Provedor de Mensagens (WhatsApp)
1. **Opção A: WAHA (WhatsApp HTTP API)**
   - Configurar URL da instância WAHA no painel de configurações (`/settings/whatsapp`).
   - Configurar Webhook da WAHA apontando para `https://<seu-dominio-staging>/api/whatsapp/waha/webhook`.
   - Ler QR Code na interface ou via `/api/whatsapp/waha/qr`.
2. **Opção B: Meta Cloud API**
   - Configurar `Phone Number ID`, `WABA ID` e `Permanent Access Token`.
   - Configurar Webhook no Meta App Dashboard apontando para `/api/whatsapp/webhook` com `verify_token` correspondente.

### B. Provedor de Inteligência (OpenAI)
1. Acessar `/settings` $\to$ **Inteligência Comercial & IA**.
2. **Modo de Invocação**: Selecionar **`Sob Demanda (On-Demand)`** (Recomendado).
3. **Provedor**: `OpenAI`.
4. **Modelo**: `gpt-4o-mini` (Econômico e ultrarrápido) ou `gpt-4o`.
5. **Chave de API**: Inserir chave no formato `sk-...`.
6. Clicar em **Salvar Configurações**.

---

## 3. Matriz de Tools Determinísticas do Copilot

O Copilot possui 7 ferramentas determinísticas allowlisted executadas antes de qualquer chamada a provedores externos:

| Ferramenta | Padrões de Pergunta Aceitos | Ação SQL Executada | Custo LLM |
|---|---|---|---|
| `searchContactsByCatalogItem` | "Quem perguntou de [Produto]?", "Leads interessados em [Item]" | Join `contact_catalog_interests` + `catalog_items` + `contacts` | **\$0.00** |
| `getTopLeadScores` | "Top leads", "Maior score", "Leads mais quentes", "Ranking de leads" | Query `contact_lead_scores` ORDER BY score DESC | **\$0.00** |
| `getOverdueTasks` | "Tarefas atrasadas", "Pendências vencidas", "O que está atrasado?" | Query `tasks` WHERE status = 'pending' AND due_at < now() | **\$0.00** |
| `searchMessageMentions` | "Quem falou [termo]?", "Mensagens sobre [palavra]" | Query `messages` WHERE content_text ILIKE '%termo%' | **\$0.00** |
| `getPipelineStageCounts` | "Etapas do funil", "Quantas oportunidades", "Distribuição de vendas" | Aggregate `deals` GROUP BY stage_id + pipeline_stages | **\$0.00** |
| `getUnansweredConversations` | "Conversas sem resposta", "Aguardando retorno", "Clientes não respondidos" | Query `conversations` WHERE unread_count > 0 | **\$0.00** |
| `explainLeadScore` | "Por que o score é [X]?", "Explicar pontuação" (com contexto de contato) | Breakdown de pontuação de `contact_lead_scores` | **\$0.00** |

---

## 4. Proteções de Segurança e Sanitização de PII

* **Sanitização Automática de PII**: Antes de enviar qualquer contexto para modelos de IA, dados sensíveis (CPFs, Cartões de Crédito) são mascarados com tokens neutros (`[CPF_PROTEGIDO]`, `[CARTAO_PROTEGIDO]`).
* **Contenção de Prompt Injection**: As mensagens de clientes recebem delimitação estrita `<customer_message>...</customer_message>` com instruções de segurança para que mensagens contendo comandos não tenham capacidade de modificar banco de dados ou regras de acesso.
* **Isolamento Multi-Tenant**: RLS estrito em `internal_ai_requests`, `ai_usage_log`, e verificação de permissão `is_account_member(account_id, role)` em todas as RPCs.

---

## 5. Roteiro de Testes de Aceitação do Piloto

1. **Teste 1: Inbound Sem Custo**
   - Enviar 10 mensagens via WhatsApp para o número de teste.
   - Verificar no banco `SELECT count(*) FROM internal_ai_requests WHERE account_id = '...'` $\to$ deve ser **0**.
2. **Teste 2: Ação On-Demand Manual**
   - No Inbox, abrir a conversa e clicar no botão **"Resumir Atendimento"**.
   - O resumo aparece no card de inteligência.
   - Verificar `ai_usage_log` $\to$ **1 registro** (`cached = false`).
3. **Teste 3: Cache Idempotente (Double-Click)**
   - Clicar novamente em **"Resumir Atendimento"** sem novas mensagens.
   - Resposta instantânea retornada do cache.
   - Verificar `ai_usage_log` $\to$ **1 novo registro** com `cached = true`, `prompt_tokens = 0`, `completion_tokens = 0`.
4. **Teste 4: Invalidação por Nova Mensagem**
   - Enviar uma nova mensagem pelo WhatsApp.
   - O badge da conversa atualiza para `Dados Anteriores` (Stale).
   - Clicar em **"Resumir Atendimento"** $\to$ Executa nova análise e atualiza cache.
5. **Teste 5: Copilot Determinístico**
   - Abrir o Copilot e digitar `"Quem perguntou da Falcon?"`.
   - Copilot responde imediatamente com a lista de clientes sem acionar OpenAI.

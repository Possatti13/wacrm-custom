# Ciclopes Design System — Helênico Contemporâneo
**Versão:** 1.0 (Phase 17B Canonical Baseline)  
**Tagline:** *Muitas conversas, uma visão.*

---

## 1. Filosofia de Marca & Propósito

O **Ciclopes** é o sistema operacional comercial baseado em conversas para equipes de vendas consultivas e atendimento de alto valor.

### Princípio Central de Produto
```
MUITAS CONVERSAS ──> SINAIS ──> CONTEXTO ──> UMA VISÃO ──> AÇÃO
```

- **Sua equipe conversa.**
- **A inteligência administra.**
- **Você tem a visão completa.**

### Personalidade da Marca
- **Helênico Contemporâneo:** Nobreza clássica, equilíbrio geométrico, sobriedade arquitetônica e sofisticação editorial aliada a performance digital de ponta.
- **Calmo, Preciso e Confiável:** Nada de neons gritantes, robôs cartunescos, gimmicks de chatbot barato ou promessas irreais de "IA que faz tudo sozinha".
- **Human-First & On-Demand:** O ser humano atende e decide; a inteligência sintetiza, pontua propensões (Lead Scoring) e sugere avanços sob demanda.

---

## 2. Paleta Canônica & Sistema de Tokens

| Token Semântico | Cor Canônica | Hex | OKLCH / CSS | Uso Principal |
| :--- | :--- | :--- | :--- | :--- |
| `--background` | **Marble White** | `#F7F3EC` | `oklch(0.965 0.012 85)` | Fundo da aplicação, sensação de mármore e papel nobre |
| `--primary` / `--sidebar` | **Aegean Blue** | `#1E3A5F` | `oklch(0.32 0.075 245)` | Âncora institucional, sidebar, botões primários |
| `--color-terracotta` | **Terracotta** | `#D16A3A` | `oklch(0.60 0.16 45)` | Accent estratégico, indicadores de ação, destaques de IA |
| `--foreground` | **Ink Charcoal** | `#2E2E2E` | `oklch(0.28 0 0)` | Tipografia principal, legibilidade máxima |
| `--border` / `--color-stone` | **Stone Beige** | `#D9CBB8` | `oklch(0.85 0.02 80)` | Bordas suaves, divisores, superfícies secundárias |

### Modos de Cor (Light & Dark)
1. **Light Mode (Default de Marca):** Base em Marble White (`#F7F3EC`), cards brancos estruturados com bordas Stone Beige (`#D9CBB8`), texto em Ink Charcoal (`#2E2E2E`) e sidebar em Deep Aegean Blue (`#1E3A5F`).
2. **Dark Mode:** Base em Deep Aegean Navy (`#0F1D2F`), cards em Aegean Slate (`#162840`), texto em Marble White (`#F7F3EC`) e toques estratégicos de Terracotta (`#D16A3A`).

---

## 3. Tipografia & Hierarquia

### Fontes Oficiais
- **Cinzel (Display / Brand):** Usada com moderação em momentos editoriais, wordmark oficial (`C I C L O P E S`), títulos de splash/login e cabeçalhos de destaque.
- **Source Sans 3 (UI / Interface / Operação):** Usada em 95% do produto — tabelas, conversas, formulários, botões e valores numéricos por sua clareza, alta legibilidade e densidade ergonômica.

### Escala Tipográfica
- `Display (Brand)`: Cinzel 32px / tracking 0.25em / SemiBold
- `Heading 1`: Cinzel 24px / tracking 0.15em / SemiBold
- `Heading 2`: Source Sans 3 18px / tracking tight / Bold
- `Heading 3 / Subhead`: Source Sans 3 15px / SemiBold
- `Body`: Source Sans 3 14px / Regular (line-height 1.5)
- `Body Small`: Source Sans 3 12px / Regular
- `Caption / Overline`: Source Sans 3 11px / SemiBold / Uppercase / tracking 0.18em
- `Numeric / Data`: Font Mono tabular numbers (JetBrains / Geist Mono)

---

## 4. Símbolo & Geometria do Logo

O símbolo do **Ciclopes** é a representação geométrica do foco, observação e clareza analítica:
1. **Contorno Amendoado do Olho:** Linhas vetoriais precisas sem excessos decorativos.
2. **Anel de Foco e Pupila Central:** Concentração de perspectiva e síntese de dados.
3. **Eixo Vertical:** Equilíbrio arquitetônico grego clássico.
4. **Pontos de Acento Terracotta:** Dois pontos nas extremidades superior e inferior do eixo.

### Componentes React Disponíveis
- `<CiclopesSymbol size={32} variant="aegean" | "white" | "terracotta" />`
- `<CiclopesWordmark size="md" variant="aegean" | "white" />`
- `<CiclopesLogo layout="horizontal" | "stacked" | "symbol-only" size="md" showTagline={true} />`

---

## 5. Navegação V1 do Produto

| Rota | Label | Ícone | Função Operacional |
| :--- | :--- | :--- | :--- |
| `/dashboard` | **Visão Geral** | `LayoutDashboard` | Painel executivo, KPIs de hoje e guia de ativação |
| `/inbox` | **Conversas** | `MessageSquare` | Atendimento humano + Visão da Conversa e Copiloto |
| `/tasks` | **Tarefas** | `ListTodo` | Follow-ups manuais e recomendados por IA |
| `/contacts` | **Contatos** | `Users` | Base de clientes com score, interesses e histórico |
| `/pipelines` | **Pipeline** | `GitBranch` | Kanban comercial com sugestões inteligentes de avanço |
| `/catalog` | **Catálogo** | `Package` | Cadastro de produtos/serviços e termos sinônimos |
| `/intelligence` | **Inteligência** | `Eye` | Central de comando de sinais, objeções e propensão |
| `/reports` | **Relatórios** | `BarChart3` | Análise executiva de conversão, tempo de resposta e demanda |
| `/settings` | **Configurações** | `Settings` | Hub de Conta, WhatsApp, Comercial e Motor de IA |

### Módulos Legados Ocultados (V1)
- `/broadcasts`, `/automations`, `/flows`, `/agents` tiveram suas rotas e backends preservados, mas foram removidos da navegação principal para focar a proposta de valor no atendimento humano e inteligência comercial on-demand.

---

## 6. Padrões de Inteligência On-Demand

1. **Transparência de Atualização:**
   - Badge "✓ Em dia" se analisado recentemente.
   - Badge "⚠️ X novas mensagens" se houver novos diálogos desde a última análise.
   - Badge "Não analisado" para conversas sem processamento.
2. **Ação Sob Demanda:**
   - Botão explícito `Analisar Conversa` / `Atualizar Visão`.
   - Nenhuma promessa de "monitoramento automático em tempo real" quando a extração for manual.
3. **Evidências Auditáveis:**
   - Qualquer sinal, intenção ou objeção detectada deve permitir clique em "Ver Evidência" e pular para a mensagem original no histórico.

---

## 7. Regras de Do / Don't

### DO (Faça)
- Use **Marble White** e **Aegean Blue** como a base de equilíbrio visual.
- Use **Terracotta** pontualmente para guiar o olhar para ações e descobertas relevantes.
- Mantenha **Source Sans 3** como a fonte de trabalho em toda a interface operacional.
- Forneça sempre **Empty States** informativos com explicações de valor e botão de ação claro.
- Deixe claro ao usuário quem realizou a ação (atendente humano vs sugestão do Ciclopes).

### DON'T (Não Faça)
- Não use Cinzel em textos corridos, tabelas ou formulários.
- Não use ilustrações cartunescas ou neon exagerado.
- Não use figuras mitológicas literais (monstros, capacetes gregos, raios de Zeus).
- Não diga que o sistema é um "bot que atende sozinho" ou "CRM genérico".

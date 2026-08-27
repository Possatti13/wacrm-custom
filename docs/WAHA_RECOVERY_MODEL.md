# Modelo de Resiliência, Reconciliação e Recuperação de Mensagens WAHA

Este documento especifica a engenharia de resiliência e recuperação de mensagens do **CICLOPES** com o provedor **WAHA**.

---

## 1. As Três Camadas de Resiliência

```
                           +------------------------------------+
                           |    Camada 1: Retentativas Webhook  |
                           |  (WAHA repete envio em caso de 5xx)|
                           +-----------------+------------------+
                                             |
                                             v
                           +------------------------------------+
                           |     Camada 2: Fila Durável PGMQ    |
                           |  (Eventos persistidos em transação)|
                           +-----------------+------------------+
                                             |
                                             v
                           +------------------------------------+
                           |  Camada 3: Motor de Reconciliação  |
                           | (Varredura com janela de sobreposição)
                           +------------------------------------+
```

1. **Camada 1 — Retentativas de Webhook**: O WAHA reenvia eventos de webhook caso a aplicação retorne código de erro temporário (5xx).
2. **Camada 2 — Fila Durável PGMQ**: Ao receber um evento válido no endpoint `/api/whatsapp/waha/webhook`, o evento é gravado atomicamente na fila `whatsapp_inbound_events` antes de retornar HTTP 200, garantindo que reinícios de processo da aplicação não percam o evento.
3. **Camada 3 — Reconciliação Ativa por Janela de Sobreposição**: Caso o webhook seja perdido (ex: queda prolongada da aplicação ou rede), o CICLOPES consulta a API de histórico do WAHA para recuperar mensagens retroativas.

---

## 2. Algoritmo de Reconciliação e Janela de Sobreposição (Overlap)

Para evitar lacunas causadas por diferenças de relógio (*clock drift*) ou mensagens recebidas durante transições de estado, o algoritmo de reconciliação utiliza uma **janela de sobreposição de segurança (Overlap Safety Window)**:

```
                          Última Sincronização Confirmada
                                      (14:30)
                                         |
                                         v
   --+-----------------------------------+--------------------------------+--> Tempo
     |                                                                    |
     |<-------- Janela de Overlap ------>|                                |
     |           (10 minutos)            |                                |
     |                                                                    |
     +--------------------------------------------------------------------+
                           Período Coletado pelo Motor
                                (14:20 até Agora)
```

1. O motor lê `last_sync_completed_at` da tabela `whatsapp_sync_state`.
2. Calcula `syncFromTimestamp = last_sync_completed_at - overlapMinutes (10 min)`.
3. Consulta o WAHA para recuperar todas as mensagens nos chats ativos com `timestamp >= syncFromTimestamp`.
4. As mensagens são normalizadas via `normalizeWahaInbound` e submetidas ao pipeline canônico `processNormalizedInboundEvent`.
5. A restrição de unicidade composta (`conversation_id` + `source_provider` + `message_id`) descarta automaticamente duplicatas no banco sem gerar efeitos colaterais.
6. A tabela `whatsapp_sync_state` é atualizada com o novo timestamp de sucesso e estatísticas de telemetria.

---

## 3. Matriz de Tratamento dos Três Domínios de Falha

| Cenário | Estado do WAHA | Estado do Ciclopes | Mecanismo de Recuperação | Garantia |
| :--- | :---: | :---: | :--- | :--- |
| **Cenário A: Ciclopes Offline Temporariamente** | Online (WORKING) | Offline | Webhook retries + Reconciliação de mensagens do WAHA ao restabelecer a conexão. | **Total**: Mensagens são recuperadas sem perda e sem duplicatas. |
| **Cenário B: WAHA Offline Temporariamente** | Offline (STOPPED / FAILED) | Online | O CRM detecta sessão desconectada. Ao reiniciar o WAHA, a sessão retorna `WORKING` e a reconciliação roda imediatamente. | **Total**: Histórico sincronizado pelo WhatsApp é ingerido. |
| **Cenário C: Máquina / VPS Inteira Offline** | Offline | Offline | Ao ligar o servidor, o Docker sobe o WAHA com o volume persistente `./waha-sessions`. O Ciclopes sobe, detecta sessão `WORKING` e executa a reconciliação. | **Dependente do WhatsApp**: O WhatsApp WEBJS/NOWEB entrega as mensagens acumuladas no celular, e o Ciclopes as ingere. |

---

## 4. Invariante Econômica de Inteligência Artificial

> [!IMPORTANT]
> **Zero Consumo de Tokens LLM na Ingestão e Reconciliação**:
> O CICLOPES opera por padrão com `invocation_mode = 'on_demand'`.
> 
> Durante a recepção de mensagens em tempo real ou durante a reconciliação de 1.000 mensagens históricas do WAHA, **o número de chamadas para APIs de IA externas (OpenAI / Anthropic / xAI) é exatamente ZERO (0)**.
> 
> O enriquecimento com inteligência só ocorre quando um usuário clica explicitamente em "Resumir", "Insights" ou "Sugerir Resposta" no Inbox.

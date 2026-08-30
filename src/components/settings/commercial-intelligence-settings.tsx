"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Flame,
  KeyRound,
  Eye,
  EyeOff,
  Save,
  RotateCcw,
  Sliders,
  TrendingUp,
} from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { canEditSettings } from "@/lib/auth/roles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { SettingsPanelHead } from "./settings-panel-head";
import type { InvocationMode, TenantCostStats } from "@/lib/intelligence/types";

const MASKED_KEY = "••••••••••••••••";

export function CommercialIntelligenceSettings() {
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Engine Settings
  const [enabled, setEnabled] = useState(false);
  const [invocationMode, setInvocationMode] = useState<InvocationMode>("on_demand");
  const [provider, setProvider] = useState<string>("openai");
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);

  // Limits
  const [maxDay, setMaxDay] = useState(1000);
  const [maxMonth, setMaxMonth] = useState(25000);
  const [budgetLimit, setBudgetLimit] = useState<string>("");

  // Cost & Usage Stats
  const [costStats, setCostStats] = useState<TenantCostStats | null>(null);

  // Scoring Weights
  const [baseScore, setBaseScore] = useState(10);
  const [intentBonus, setIntentBonus] = useState(30);
  const [urgencyHighBonus, setUrgencyHighBonus] = useState(20);
  const [catalogBonus, setCatalogBonus] = useState(20);
  const [budgetBonus, setBudgetBonus] = useState(15);
  const [objectionPenalty, setObjectionPenalty] = useState(-15);

  // Simulation State
  const [simIntent, setSimIntent] = useState<string>("purchase");
  const [simUrgency, setSimUrgency] = useState<string>("high");
  const [simInterest, setSimInterest] = useState(true);
  const [simBudget, setSimBudget] = useState(true);
  const [simObjection, setSimObjection] = useState(false);
  const [simResult, setSimResult] = useState<{
    score: number;
    qualification: string;
    breakdown: Record<string, { points: number; rule: string; matched: boolean }>;
  } | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ai/intelligence-settings");
      if (!res.ok) throw new Error("Falha ao carregar configurações");
      const data = await res.json();

      if (data.settings) {
        setEnabled(!!data.settings.enabled);
        setInvocationMode(data.settings.invocation_mode || "on_demand");
        setProvider(data.settings.provider || "openai");
        setModel(data.settings.model || "gpt-4o-mini");
        setMaxDay(data.settings.max_ai_actions_per_day ?? 1000);
        setMaxMonth(data.settings.max_ai_actions_per_month ?? 25000);
        setBudgetLimit(data.settings.monthly_budget_limit_usd ? String(data.settings.monthly_budget_limit_usd) : "");
      }

      if (data.cost_stats) {
        setCostStats(data.cost_stats);
      }

      setHasStoredKey(!!data.has_api_key);
      if (data.has_api_key) {
        setApiKey(MASKED_KEY);
      }

      if (data.scoring?.config) {
        setBaseScore(data.scoring.config.base_score ?? 10);
      }
    } catch (err) {
      console.error("Erro ao carregar inteligência comercial:", err);
      toast.error("Erro ao carregar configurações de inteligência.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  // Live Simulator Effect
  useEffect(() => {
    let current = Number(baseScore) || 10;
    const bd: Record<string, { points: number; rule: string; matched: boolean }> = {
      base: { points: current, rule: "Pontuação Base", matched: true },
    };

    if (simIntent === "purchase") {
      current += intentBonus;
      bd.intent = { points: intentBonus, rule: "Intenção de Compra", matched: true };
    }
    if (simUrgency === "high") {
      current += urgencyHighBonus;
      bd.urgency = { points: urgencyHighBonus, rule: "Alta Urgência", matched: true };
    }
    if (simInterest) {
      current += catalogBonus;
      bd.interest = { points: catalogBonus, rule: "Interesse no Catálogo", matched: true };
    }
    if (simBudget) {
      current += budgetBonus;
      bd.budget = { points: budgetBonus, rule: "Compatibilidade de Orçamento", matched: true };
    }
    if (simObjection) {
      current += objectionPenalty;
      bd.objection = { points: objectionPenalty, rule: "Objeção Ativa", matched: true };
    }

    const final = Math.max(0, Math.min(100, current));
    setSimResult({
      score: final,
      qualification: final >= 70 ? "Hot Lead 🔥" : final >= 40 ? "Warm Lead ⚡" : "Cold Lead ❄️",
      breakdown: bd,
    });
  }, [
    baseScore,
    intentBonus,
    urgencyHighBonus,
    catalogBonus,
    budgetBonus,
    objectionPenalty,
    simIntent,
    simUrgency,
    simInterest,
    simBudget,
    simObjection,
  ]);

  const handleSave = async () => {
    if (!canEdit) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        settings: {
          enabled,
          invocation_mode: invocationMode,
          provider,
          model,
          max_ai_actions_per_day: Number(maxDay) || 1000,
          max_ai_actions_per_month: Number(maxMonth) || 25000,
          monthly_budget_limit_usd: budgetLimit ? Number(budgetLimit) : null,
        },
        scoringConfig: {
          enabled: true,
          base_score: baseScore,
          min_score: 0,
          max_score: 100,
        },
        scoringRules: [
          { rule_name: "base_score", weight: baseScore, rule_type: "base" },
          { rule_name: "intent_purchase", weight: intentBonus, rule_type: "intent" },
          { rule_name: "urgency_high", weight: urgencyHighBonus, rule_type: "urgency" },
          { rule_name: "catalog_interest", weight: catalogBonus, rule_type: "catalog" },
          { rule_name: "budget_match", weight: budgetBonus, rule_type: "budget" },
          { rule_name: "objection_penalty", weight: objectionPenalty, rule_type: "objection" },
        ],
      };

      if (keyEdited && apiKey !== MASKED_KEY) {
        payload.apiKey = apiKey;
      }

      const res = await fetch("/api/ai/intelligence-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Erro ao salvar configurações");
      }

      toast.success("Configurações salvas com sucesso!");
      setKeyEdited(false);
      fetchSettings();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro ao salvar: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  const handleResetWeights = () => {
    setBaseScore(10);
    setIntentBonus(30);
    setUrgencyHighBonus(20);
    setCatalogBonus(20);
    setBudgetBonus(15);
    setObjectionPenalty(-15);
    toast.info("Pesos restaurados para o padrão de mercado.");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  const cacheRate = costStats && costStats.total_requests > 0
    ? Math.round((costStats.cached_requests / costStats.total_requests) * 100)
    : 0;

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Inteligência Interna & Lead Scoring"
        description="Configure o motor de IA interna sob demanda, limites de custo e as regras determinísticas de pontuação."
      />

      {/* 1. USAGE & COST CONTROL DASHBOARD */}
      {costStats && (
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  Métricas de Consumo & Economia de IA (Mês Atual)
                </CardTitle>
                <CardDescription className="text-xs">
                  Acompanhamento de requisições internas, taxa de cache e estimativa de investimento.
                </CardDescription>
              </div>
              <Badge variant="outline" className="font-mono text-xs">
                {cacheRate}% Economizado via Cache
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="rounded-lg border bg-background p-3">
                <div className="text-[11px] text-muted-foreground">Ações de IA Solicitadas</div>
                <div className="text-xl font-bold font-mono mt-0.5">{costStats.total_requests}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{costStats.cached_requests} no cache</div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-[11px] text-muted-foreground">Chamadas Reais ao Provedor</div>
                <div className="text-xl font-bold font-mono mt-0.5 text-primary">{costStats.provider_calls}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Executadas via LLM</div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-[11px] text-muted-foreground">Total de Tokens Processados</div>
                <div className="text-xl font-bold font-mono mt-0.5">{costStats.total_tokens.toLocaleString()}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {costStats.total_prompt_tokens.toLocaleString()} in / {costStats.total_completion_tokens.toLocaleString()} out
                </div>
              </div>
              <div className="rounded-lg border bg-background p-3">
                <div className="text-[11px] text-muted-foreground">Custo Estimado (USD)</div>
                <div className="text-xl font-bold font-mono mt-0.5 text-emerald-600 dark:text-emerald-400">
                  ${Number(costStats.total_estimated_cost).toFixed(4)}
                </div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Baseado na tabela oficial</div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. INVOCATION & ENGINE CONTROL */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Modo de Invocação da Inteligência
              </CardTitle>
              <CardDescription className="text-xs">
                Defina quando e como a IA interna deve ser acionada pelos usuários da empresa.
              </CardDescription>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              disabled={!canEdit}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Modo de Invocação</Label>
              <Select
                value={invocationMode}
                onValueChange={(val) => val && setInvocationMode(val as InvocationMode)}
                disabled={!canEdit || !enabled}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smart_auto">✨ Smart Automático (Debounce & Burst)</SelectItem>
                  <SelectItem value="on_demand">⚡ Sob Demanda (Manual / Botão)</SelectItem>
                  <SelectItem value="off">🚫 Desativado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Provedor de IA</Label>
              <Select
                value={provider}
                onValueChange={(val) => {
                  if (val) {
                    setProvider(val);
                    if (val === "gemini") setModel("gemini-1.5-flash");
                    else if (val === "openai") setModel("gpt-4o-mini");
                    else if (val === "anthropic") setModel("claude-3-5-sonnet-20241022");
                    else if (val === "xai") setModel("grok-beta");
                    else if (val === "mock") setModel("mock-model-v1");
                  }
                }}
                disabled={!canEdit || !enabled}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="xai">Grok / xAI</SelectItem>
                  <SelectItem value="mock">Mock Simulator (Testes)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Modelo de IA</Label>
              <Select
                value={model}
                onValueChange={(val) => val && setModel(val)}
                disabled={!canEdit || !enabled}
              >
                <SelectTrigger className="h-9 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {provider === "gemini" && (
                    <>
                      <SelectItem value="gemini-1.5-flash">gemini-1.5-flash (Rápido & Free Tier)</SelectItem>
                      <SelectItem value="gemini-2.0-flash">gemini-2.0-flash (Nova Geração)</SelectItem>
                      <SelectItem value="gemini-1.5-pro">gemini-1.5-pro (Raciocínio Profundo)</SelectItem>
                    </>
                  )}
                  {provider === "openai" && (
                    <>
                      <SelectItem value="gpt-4o-mini">gpt-4o-mini (Custo-Benefício)</SelectItem>
                      <SelectItem value="gpt-4o">gpt-4o (Alta Capacidade)</SelectItem>
                    </>
                  )}
                  {provider === "anthropic" && (
                    <>
                      <SelectItem value="claude-3-5-haiku-20241022">claude-3-5-haiku</SelectItem>
                      <SelectItem value="claude-3-5-sonnet-20241022">claude-3-5-sonnet</SelectItem>
                    </>
                  )}
                  {provider === "xai" && (
                    <SelectItem value="grok-beta">grok-beta</SelectItem>
                  )}
                  {provider === "mock" && (
                    <SelectItem value="mock-model-v1">mock-model-v1</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Mode Explanatory Notice */}
          <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
            {invocationMode === "smart_auto" && (
              <p>
                ✨ <strong>Modo Smart Automático:</strong> Agrupa mensagens recebidas com janela de debounce (~15 min) ou disparo imediato em rajadas (≥ 6 msgs). Executa no máximo <strong>1 job consolidado</strong> sem chamadas desnecessárias por mensagem.
              </p>
            )}
            {invocationMode === "on_demand" && (
              <p>
                💡 <strong>Modo Sob Demanda:</strong> 10.000 mensagens recebidas no WhatsApp geram <strong>0 chamadas de IA</strong>. A IA só é acionada quando um vendedor ou gestor clicar em &quot;Analisar&quot;, &quot;Resumir&quot; ou consultar o Copilot.
              </p>
            )}
            {invocationMode === "off" && (
              <p>
                🚫 <strong>Modo Desativado:</strong> Todos os recursos de IA interna estão desligados.
              </p>
            )}
            {provider === "gemini" && (
              <p className="text-[11px] text-amber-600 dark:text-amber-400 pt-1 border-t border-border/50 mt-1">
                ⚠️ Para testes com planos gratuitos do provider, utilize somente dados sintéticos ou anonimizados conforme os termos aplicáveis do provedor.
              </p>
            )}
          </div>

          {/* Limits */}
          <div className="grid gap-4 sm:grid-cols-3 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Limite de Ações/Dia</Label>
              <Input
                type="number"
                min={0}
                value={maxDay}
                onChange={(e) => setMaxDay(Number(e.target.value))}
                disabled={!canEdit || !enabled}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Limite de Ações/Mês</Label>
              <Input
                type="number"
                min={0}
                value={maxMonth}
                onChange={(e) => setMaxMonth(Number(e.target.value))}
                disabled={!canEdit || !enabled}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Teto de Orçamento Mensal (USD)</Label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="Opcional (ex: 50.00)"
                value={budgetLimit}
                onChange={(e) => setBudgetLimit(e.target.value)}
                disabled={!canEdit || !enabled}
                className="h-9 text-xs font-mono"
              />
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              Chave de API do Provedor
              {hasStoredKey && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">
                  (Chave configurada e criptografada com AES-256-GCM)
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                placeholder="sk-..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyEdited(true);
                }}
                disabled={!canEdit || !enabled}
                className="pr-10 font-mono text-xs h-9"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-9 w-9 px-0 text-muted-foreground"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. DETERMINISTIC LEAD SCORING CONFIGURATION */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Flame className="h-4 w-4 text-emerald-500" />
                Regras Determinísticas de Lead Scoring
              </CardTitle>
              <CardDescription className="text-xs">
                A pontuação (0 a 100) é calculada de forma 100% determinística a partir dos dados do perfil comercial.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={handleResetWeights}
              disabled={!canEdit}
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Restaurar Padrão
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Pontuação Base (Novo Lead)</Label>
              <Input
                type="number"
                value={baseScore}
                onChange={(e) => setBaseScore(Number(e.target.value))}
                disabled={!canEdit}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bônus: Intenção de Compra</Label>
              <Input
                type="number"
                value={intentBonus}
                onChange={(e) => setIntentBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bônus: Alta Urgência</Label>
              <Input
                type="number"
                value={urgencyHighBonus}
                onChange={(e) => setUrgencyHighBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bônus: Interesse no Catálogo</Label>
              <Input
                type="number"
                value={catalogBonus}
                onChange={(e) => setCatalogBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Bônus: Orçamento Compatível</Label>
              <Input
                type="number"
                value={budgetBonus}
                onChange={(e) => setBudgetBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-9 text-xs font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Penalidade: Objeção Aberta</Label>
              <Input
                type="number"
                value={objectionPenalty}
                onChange={(e) => setObjectionPenalty(Number(e.target.value))}
                disabled={!canEdit}
                className="h-9 text-xs font-mono text-rose-500"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 4. LIVE SIMULATOR */}
      <Card className="border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" />
            Simulador de Lead Scoring em Tempo Real
          </CardTitle>
          <CardDescription className="text-xs">
            Teste interativamente como os pesos configurados acima impactam o score final do cliente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Intenção Simulada</Label>
                <Select value={simIntent} onValueChange={(v) => setSimIntent(v || 'purchase')}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="purchase">Compra Declarada</SelectItem>
                    <SelectItem value="support">Suporte / Dúvida Operacional</SelectItem>
                    <SelectItem value="unknown">Indeterminado</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Urgência Simulada</Label>
                <Select value={simUrgency} onValueChange={(v) => setSimUrgency(v || 'high')}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="high">Alta (Compra Imediata / Esta Semana)</SelectItem>
                    <SelectItem value="medium">Média (Planejando Compra)</SelectItem>
                    <SelectItem value="low">Baixa (Apenas Pesquisando)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simInterest}
                    onChange={(e) => setSimInterest(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>Interesse em Item do Catálogo</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={simBudget}
                    onChange={(e) => setSimBudget(e.target.checked)}
                    className="rounded border-border text-primary"
                  />
                  <span>Orçamento Compatível</span>
                </label>
                <label className="flex items-center gap-2 text-xs cursor-pointer text-rose-500">
                  <input
                    type="checkbox"
                    checked={simObjection}
                    onChange={(e) => setSimObjection(e.target.checked)}
                    className="rounded border-border text-rose-500"
                  />
                  <span>Objeção Ativa Aberta</span>
                </label>
              </div>
            </div>

            {/* Result Preview */}
            {simResult && (
              <div className="rounded-xl border bg-muted/30 p-4 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-muted-foreground">Score Resultante</span>
                    <Badge variant="outline" className="font-mono text-sm font-bold">
                      {simResult.score} / 100
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm font-semibold text-foreground">
                    {simResult.qualification}
                  </div>
                  <div className="mt-3 space-y-1 font-mono text-xs">
                    {Object.entries(simResult.breakdown).map(([k, v]) => (
                      <div key={k} className="flex justify-between text-muted-foreground">
                        <span>{v.rule}:</span>
                        <span className={v.points >= 0 ? "text-emerald-600 dark:text-emerald-400 font-bold" : "text-rose-500 font-bold"}>
                          {v.points >= 0 ? `+${v.points}` : v.points}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      {canEdit && (
        <div className="flex justify-end pt-2">
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : "Salvar Configurações"}
          </Button>
        </div>
      )}
    </div>
  );
}

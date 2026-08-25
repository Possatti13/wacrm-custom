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
import { cn } from "@/lib/utils";

const MASKED_KEY = "••••••••••••••••";

export function CommercialIntelligenceSettings() {
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Engine Settings
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<string>("openai");
  const [model, setModel] = useState<string>("gpt-4o-mini");
  const [apiKey, setApiKey] = useState("");
  const [keyEdited, setKeyEdited] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [hasStoredKey, setHasStoredKey] = useState(false);

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
        setProvider(data.settings.provider || "openai");
        setModel(data.settings.model || "gpt-4o-mini");
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
          provider,
          model,
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
        payload.apiKey = apiKey.trim();
      }

      const res = await fetch("/api/ai/intelligence-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Falha ao salvar configurações");
      }

      toast.success("Configurações de Inteligência Comercial salvas com sucesso!");
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

  return (
    <div className="space-y-6">
      <SettingsPanelHead
        title="Inteligência Comercial & Lead Scoring"
        description="Configure o motor de extração em tempo real e as regras determinísticas de pontuação de leads."
      />

      {/* 1. EXTRACTION ENGINE CONTROL */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Motor de Extração Contínua
              </CardTitle>
              <CardDescription className="text-xs">
                Analisa mensagens de clientes em background para extrair intenções, produtos e objeções.
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Provedor de IA</Label>
              <Select
                value={provider}
                onValueChange={(val) => val && setProvider(val)}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic (Claude)</SelectItem>
                  <SelectItem value="xai">Grok / xAI</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Modelo de Extração</Label>
              <Select
                value={model}
                onValueChange={(val) => val && setModel(val)}
                disabled={!canEdit}
              >
                <SelectTrigger className="h-9 text-xs font-mono">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4o-mini">gpt-4o-mini (Recomendado para velocidade e custo)</SelectItem>
                  <SelectItem value="gpt-4o">gpt-4o (Máxima capacidade analítica)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-1.5 pt-1">
            <Label className="text-xs flex items-center gap-1.5">
              <KeyRound className="h-3.5 w-3.5 text-muted-foreground" />
              Chave de API do Provedor
              {hasStoredKey && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-normal">
                  (Chave configurada e criptografada)
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setKeyEdited(true);
                }}
                placeholder={hasStoredKey ? MASKED_KEY : "sk-..."}
                disabled={!canEdit}
                className="h-9 text-xs font-mono pr-10"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 2. LEAD SCORING DETERMINISTIC RULES */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <Flame className="h-4 w-4 text-emerald-500" />
                Regras de Pontuação do Lead (0 a 100)
              </CardTitle>
              <CardDescription className="text-xs">
                A pontuação é 100% determinística, auditável e recalculada a cada sinal factual.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetWeights}
              disabled={!canEdit}
              className="text-xs gap-1 h-8"
            >
              <RotateCcw className="h-3 w-3" />
              Restaurar Padrões
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 pt-1">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5 rounded-lg border border-border p-3 bg-muted/20">
              <Label className="text-xs font-medium">Pontuação Base</Label>
              <Input
                type="number"
                value={baseScore}
                onChange={(e) => setBaseScore(Number(e.target.value))}
                disabled={!canEdit}
                className="h-8 text-xs font-mono"
              />
              <p className="text-[10px] text-muted-foreground">Pontos de partida ao iniciar conversa.</p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border p-3 bg-muted/20">
              <Label className="text-xs font-medium text-emerald-600">Bônus: Intenção de Compra</Label>
              <Input
                type="number"
                value={intentBonus}
                onChange={(e) => setIntentBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-8 text-xs font-mono text-emerald-600"
              />
              <p className="text-[10px] text-muted-foreground">Adicionado quando cliente quer comprar.</p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border p-3 bg-muted/20">
              <Label className="text-xs font-medium text-emerald-600">Bônus: Alta Urgência</Label>
              <Input
                type="number"
                value={urgencyHighBonus}
                onChange={(e) => setUrgencyHighBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-8 text-xs font-mono text-emerald-600"
              />
              <p className="text-[10px] text-muted-foreground">Adicionado quando o prazo é imediato.</p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border p-3 bg-muted/20">
              <Label className="text-xs font-medium text-emerald-600">Bônus: Interesse no Catálogo</Label>
              <Input
                type="number"
                value={catalogBonus}
                onChange={(e) => setCatalogBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-8 text-xs font-mono text-emerald-600"
              />
              <p className="text-[10px] text-muted-foreground">Adicionado ao citar item do catálogo.</p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border p-3 bg-muted/20">
              <Label className="text-xs font-medium text-emerald-600">Bônus: Orçamento Adequado</Label>
              <Input
                type="number"
                value={budgetBonus}
                onChange={(e) => setBudgetBonus(Number(e.target.value))}
                disabled={!canEdit}
                className="h-8 text-xs font-mono text-emerald-600"
              />
              <p className="text-[10px] text-muted-foreground">Adicionado se o cliente tem orçamento.</p>
            </div>

            <div className="space-y-1.5 rounded-lg border border-border p-3 bg-muted/20">
              <Label className="text-xs font-medium text-rose-600">Penalidade: Objeção Ativa</Label>
              <Input
                type="number"
                value={objectionPenalty}
                onChange={(e) => setObjectionPenalty(Number(e.target.value))}
                disabled={!canEdit}
                className="h-8 text-xs font-mono text-rose-600"
              />
              <p className="text-[10px] text-muted-foreground">Subtraído enquanto houver objeção em aberto.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 3. INTERACTIVE SIMULATOR */}
      <Card className="border-primary/30 bg-primary/[0.02]">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sliders className="h-4 w-4 text-primary" />
            Simulador de Qualificação em Tempo Real
          </CardTitle>
          <CardDescription className="text-xs">
            Teste os pesos configurados acima simulando diferentes perfis de clientes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Simulation Inputs */}
            <div className="space-y-3 rounded-xl border border-border bg-background p-3.5">
              <h4 className="text-xs font-semibold text-foreground">Sinais do Cliente</h4>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span>Intenção de Compra</span>
                  <Switch
                    checked={simIntent === "purchase"}
                    onCheckedChange={(c) => setSimIntent(c ? "purchase" : "support")}
                  />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span>Alta Urgência (Imediato)</span>
                  <Switch
                    checked={simUrgency === "high"}
                    onCheckedChange={(c) => setSimUrgency(c ? "high" : "low")}
                  />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span>Interesse em Item do Catálogo</span>
                  <Switch
                    checked={simInterest}
                    onCheckedChange={setSimInterest}
                  />
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span>Orçamento Compatível</span>
                  <Switch
                    checked={simBudget}
                    onCheckedChange={setSimBudget}
                  />
                </div>

                <div className="flex items-center justify-between text-xs text-rose-600 font-medium">
                  <span>Possui Objeção Não Resolvida</span>
                  <Switch
                    checked={simObjection}
                    onCheckedChange={setSimObjection}
                  />
                </div>
              </div>
            </div>

            {/* Simulation Output Gauge */}
            {simResult && (
              <div className="flex flex-col justify-between rounded-xl border border-border bg-background p-3.5 space-y-3">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground">Lead Score Resultante</span>
                    <Badge
                      variant="outline"
                      className="font-semibold text-xs"
                    >
                      {simResult.qualification}
                    </Badge>
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold font-mono text-primary">
                      {simResult.score}
                    </span>
                    <span className="text-xs text-muted-foreground">/ 100 pontos</span>
                  </div>
                </div>

                {/* Breakdown List */}
                <div className="space-y-1 pt-2 border-t border-border/80">
                  <span className="text-[11px] font-semibold text-foreground">Composição da Pontuação:</span>
                  <div className="space-y-1">
                    {Object.entries(simResult.breakdown).map(([key, item]) => (
                      <div
                        key={key}
                        className="flex items-center justify-between text-[11px]"
                      >
                        <span className="text-muted-foreground truncate">{item.rule}</span>
                        <span
                          className={cn(
                            "font-mono font-semibold ml-2",
                            item.points >= 0 ? "text-emerald-600" : "text-rose-600"
                          )}
                        >
                          {item.points >= 0 ? `+${item.points}` : item.points}
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

      {/* Save Action */}
      {canEdit && (
        <div className="flex justify-end pt-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            className="gap-2 shadow-sm"
          >
            <Save className="h-4 w-4" />
            {saving ? "Salvando..." : "Salvar Configurações de Inteligência"}
          </Button>
        </div>
      )}
    </div>
  );
}

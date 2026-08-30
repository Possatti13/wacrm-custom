"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import {
  saveTenantCommercialContext,
  getTenantCommercialContext,
} from "@/lib/commercial-config/repository";
import { listCatalogItems, createCatalogItem } from "@/lib/catalog/repository";
import type { CatalogItem } from "@/lib/catalog/types";
import {
  QrCode,
  Building2,
  Package,
  Users,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Plus,
  Shield,
  MessageSquare,
  Flame,
  Check,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "WhatsApp", icon: QrCode },
  { id: 2, label: "Contexto", icon: Building2 },
  { id: 3, label: "Catálogo", icon: Package },
  { id: 4, label: "Equipe", icon: Users },
  { id: 5, label: "Inteligência", icon: Sparkles },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { accountId, profile, accountRole } = useAuth();
  const isManager = accountRole === "owner" || accountRole === "admin";

  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Step 1: WhatsApp state
  const [whatsappConnected, setWhatsappConnected] = useState(false);

  // Step 2: Commercial Context state
  const [companyDescription, setCompanyDescription] = useState("");
  const [targetAudience, setTargetAudience] = useState("");
  const [qualificationSignals, setQualificationSignals] = useState("");
  const [commonObjections, setCommonObjections] = useState("");

  // Step 3: Catalog state
  const [catalogItems, setCatalogItems] = useState<CatalogItem[]>([]);
  const [newItemName, setNewItemName] = useState("");
  const [newItemType, setNewItemType] = useState<"product" | "service">("product");
  const [newItemPrice, setNewItemPrice] = useState("");

  // Step 4: Team state
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"agent" | "admin" | "viewer">("agent");
  const [invitedMembers, setInvitedMembers] = useState<string[]>([]);

  // Load initial data
  const loadOnboardingData = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    const supabase = createClient();

    try {
      // 1. WhatsApp status
      const { data: wahaData } = await supabase
        .from("whatsapp_configs")
        .select("status")
        .eq("account_id", accountId)
        .maybeSingle();
      if (wahaData && wahaData.status === "connected") {
        setWhatsappConnected(true);
      }

      // 2. Business context
      try {
        const ctx = await getTenantCommercialContext(supabase, accountId);
        if (ctx) {
          setCompanyDescription(ctx.company_description || "");
          setTargetAudience(ctx.commercial_objectives || "");
          setQualificationSignals(ctx.qualification_guidelines || "");
          setCommonObjections(ctx.terminology_notes || "");
        }
      } catch (e) {
        console.warn("No context yet", e);
      }

      // 3. Catalog items
      try {
        const items = await listCatalogItems(supabase, accountId);
        setCatalogItems(items);
      } catch (e) {
        console.warn("Catalog error", e);
      }
    } catch (err) {
      console.error("Failed to load onboarding:", err);
    } finally {
      setLoading(false);
    }
  }, [accountId]);

  useEffect(() => {
    loadOnboardingData();
  }, [loadOnboardingData]);

  // Save Step 2 Context
  const handleSaveContext = async () => {
    if (!accountId) return;
    setSaving(true);
    const supabase = createClient();

    try {
      await saveTenantCommercialContext(supabase, accountId, {
        company_description: companyDescription,
        commercial_objectives: targetAudience,
        qualification_guidelines: qualificationSignals,
        terminology_notes: commonObjections,
        change_summary: "Onboarding wizard context setup",
      });
      toast.success("Contexto comercial salvo!");
      setCurrentStep(3);
    } catch (err) {
      console.error("Failed to save context:", err);
      toast.error("Erro ao salvar contexto.");
    } finally {
      setSaving(false);
    }
  };

  // Add Catalog Item in Step 3
  const handleAddCatalogItem = async () => {
    if (!accountId || !newItemName.trim()) return;
    setSaving(true);
    const supabase = createClient();

    try {
      const created = await createCatalogItem(supabase, accountId, {
        name: newItemName.trim(),
        type: newItemType,
        description: newItemPrice.trim() || undefined,
      });

      setCatalogItems((prev) => [...prev, created]);
      setNewItemName("");
      setNewItemPrice("");
      toast.success("Item adicionado ao catálogo!");
    } catch (err) {
      console.error("Failed to add item:", err);
      toast.error("Erro ao adicionar item.");
    } finally {
      setSaving(false);
    }
  };

  // Invite Member in Step 4
  const handleInviteMember = async () => {
    if (!inviteEmail.trim() || !accountId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/account/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail.trim(),
          role: inviteRole,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Falha ao enviar convite");
      }

      setInvitedMembers((prev) => [...prev, `${inviteEmail} (${inviteRole})`]);
      setInviteEmail("");
      toast.success("Convite enviado com sucesso!");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro desconhecido";
      toast.error(`Erro: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  // Finalize Onboarding
  const handleFinishOnboarding = () => {
    toast.success("Configuração inicial concluída com sucesso!");
    if (isManager) {
      router.push("/dashboard");
    } else {
      router.push("/inbox");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 sm:py-10 px-4 space-y-8">
      {/* Header */}
      <div className="text-center space-y-2">
        <Badge variant="outline" className="text-xs font-semibold px-3 py-1 border-primary/30 text-primary bg-primary/5">
          Guia de Ativação
        </Badge>
        <h1 className="text-2xl sm:text-3xl font-bold font-sans tracking-tight text-foreground">
          Configuração do seu Workspace
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-md mx-auto">
          Complete os passos essenciais para que o Ciclopes conheça sua operação e apoie seu time de vendas.
        </p>
      </div>

      {/* Stepper Progress Bar */}
      <div className="flex items-center justify-between relative px-2">
        <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-0.5 bg-border -z-10" />
        {STEPS.map((s) => {
          const isDone = s.id < currentStep;
          const isCurrent = s.id === currentStep;
          const Icon = s.icon;

          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setCurrentStep(s.id)}
              className="flex flex-col items-center gap-1.5 group cursor-pointer"
            >
              <div
                className={cn(
                  "size-9 rounded-full flex items-center justify-center text-xs font-bold transition-all border-2",
                  isDone
                    ? "bg-emerald-600 border-emerald-600 text-white"
                    : isCurrent
                    ? "bg-[#1E3A5F] border-[#1E3A5F] text-white shadow-md scale-105"
                    : "bg-card border-border text-muted-foreground group-hover:border-primary/50"
                )}
              >
                {isDone ? <Check className="size-4" /> : <Icon className="size-4" />}
              </div>
              <span
                className={cn(
                  "text-[11px] font-semibold tracking-tight hidden sm:block",
                  isCurrent ? "text-foreground font-bold" : "text-muted-foreground"
                )}
              >
                {s.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Step Content */}
      <Card className="border-border bg-card shadow-sm">
        <CardContent className="p-6 sm:p-8">
          {/* STEP 1: WHATSAPP */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-foreground">1. Conexão do WhatsApp</h3>
                <p className="text-xs text-muted-foreground">
                  Conecte seu número de WhatsApp comercial para centralizar o atendimento e receber mensagens em tempo real.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="size-10 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-600">
                      <QrCode className="size-5" />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-foreground">Sessão WhatsApp</h4>
                      <p className="text-xs text-muted-foreground">
                        {whatsappConnected ? "WhatsApp conectado e sincronizado" : "Nenhum número conectado no momento"}
                      </p>
                    </div>
                  </div>

                  <Badge
                    variant={whatsappConnected ? "default" : "outline"}
                    className={cn(
                      "text-xs font-semibold px-2.5 py-0.5",
                      whatsappConnected
                        ? "bg-emerald-600 text-white"
                        : "text-amber-600 border-amber-500/30 bg-amber-500/10"
                    )}
                  >
                    {whatsappConnected ? "Conectado" : "Pendente"}
                  </Badge>
                </div>

                <div className="space-y-2 pt-2 border-t border-border/60 text-xs text-muted-foreground">
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    Receba mensagens dos clientes diretamente na Caixa de Entrada
                  </p>
                  <p className="flex items-center gap-2">
                    <CheckCircle2 className="size-3.5 text-emerald-500 shrink-0" />
                    O Copiloto apoia seus vendedores durante todo o diálogo
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/60">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push("/settings?tab=whatsapp")}
                  className="text-xs border-border"
                >
                  Ir para configuração do WhatsApp
                </Button>

                <Button
                  onClick={() => setCurrentStep(2)}
                  className="h-9 px-4 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                >
                  <span>Continuar</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: BUSINESS CONTEXT */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-foreground">2. Contexto do Negócio</h3>
                <p className="text-xs text-muted-foreground">
                  Ensine à IA o que sua empresa vende e como funciona seu processo de vendas para obter respostas personalizadas.
                </p>
              </div>

              <div className="space-y-4 text-xs">
                <div className="space-y-1.5">
                  <Label htmlFor="company-desc" className="text-xs font-semibold text-foreground">
                    O que sua empresa vende?
                  </Label>
                  <Textarea
                    id="company-desc"
                    value={companyDescription}
                    onChange={(e) => setCompanyDescription(e.target.value)}
                    placeholder="Ex: Somos uma assessoria de marketing que ajuda empresas B2B a gerarem oportunidades qualificadas..."
                    rows={3}
                    className="text-xs bg-background border-border"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="target-aud" className="text-xs font-semibold text-foreground">
                    Quem costuma comprar de você?
                  </Label>
                  <Input
                    id="target-aud"
                    value={targetAudience}
                    onChange={(e) => setTargetAudience(e.target.value)}
                    placeholder="Ex: Diretores comerciais, fundadores de startups e gerentes de marketing"
                    className="text-xs bg-background border-border h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="qual-signals" className="text-xs font-semibold text-foreground">
                    O que indica um lead muito interessado (quente)?
                  </Label>
                  <Input
                    id="qual-signals"
                    value={qualificationSignals}
                    onChange={(e) => setQualificationSignals(e.target.value)}
                    placeholder="Ex: Pede proposta de preço, pergunta sobre prazo de início ou menciona orçamento aprovado"
                    className="text-xs bg-background border-border h-9"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="obj-notes" className="text-xs font-semibold text-foreground">
                    Quais objeções aparecem com frequência?
                  </Label>
                  <Input
                    id="obj-notes"
                    value={commonObjections}
                    onChange={(e) => setCommonObjections(e.target.value)}
                    placeholder="Ex: 'Preço alto', 'Vou ver com meu sócio', 'Já tenho fornecedor'"
                    className="text-xs bg-background border-border h-9"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/60">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(1)}
                  className="text-xs text-muted-foreground"
                >
                  <ArrowLeft className="size-3.5 mr-1" />
                  Voltar
                </Button>

                <Button
                  onClick={handleSaveContext}
                  disabled={saving}
                  className="h-9 px-4 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                >
                  <span>{saving ? "Salvando..." : "Salvar e Continuar"}</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: CATALOG */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-foreground">3. Catálogo de Produtos & Serviços</h3>
                <p className="text-xs text-muted-foreground">
                  Cadastre seus principais itens para que a IA reconheça automaticamente o interesse de compra nas conversas.
                </p>
              </div>

              {/* Add item form */}
              <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                <span className="text-xs font-semibold text-foreground block">
                  Adicionar produto ou serviço
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    placeholder="Nome do produto ou serviço"
                    className="h-8.5 text-xs bg-background border-border sm:col-span-2"
                  />
                  <Input
                    type="number"
                    value={newItemPrice}
                    onChange={(e) => setNewItemPrice(e.target.value)}
                    placeholder="Valor (R$)"
                    className="h-8.5 text-xs bg-background border-border"
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setNewItemType("product")}
                      className={cn(
                        "px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                        newItemType === "product"
                          ? "bg-primary text-primary-foreground shadow-2xs"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      Produto
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewItemType("service")}
                      className={cn(
                        "px-2.5 py-1 rounded text-[11px] font-semibold transition-all",
                        newItemType === "service"
                          ? "bg-primary text-primary-foreground shadow-2xs"
                          : "bg-muted text-muted-foreground"
                      )}
                    >
                      Serviço
                    </button>
                  </div>

                  <Button
                    size="sm"
                    onClick={handleAddCatalogItem}
                    disabled={!newItemName.trim() || saving}
                    className="h-8 text-xs font-semibold gap-1 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                  >
                    <Plus className="size-3" />
                    Adicionar
                  </Button>
                </div>
              </div>

              {/* Items List */}
              <div className="space-y-2">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Itens cadastrados ({catalogItems.length})
                </span>
                {catalogItems.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic py-3 text-center">
                    Nenhum item cadastrado ainda. Adicione pelo menos um item ou avance para adicionar depois.
                  </p>
                ) : (
                  <div className="divide-y divide-border/50 rounded-lg border border-border bg-card">
                    {catalogItems.map((it) => (
                      <div key={it.id} className="p-3 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <Package className="size-3.5 text-primary shrink-0" />
                          <span className="font-semibold text-foreground">{it.name}</span>
                          <Badge variant="outline" className="text-[10px] py-0 px-1.5 uppercase">
                            {it.type === "service" ? "Serviço" : "Produto"}
                          </Badge>
                        </div>
                        {it.description && (
                          <span className="text-muted-foreground text-xs truncate max-w-[200px]">
                            {it.description}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/60">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(2)}
                  className="text-xs text-muted-foreground"
                >
                  <ArrowLeft className="size-3.5 mr-1" />
                  Voltar
                </Button>

                <Button
                  onClick={() => setCurrentStep(4)}
                  className="h-9 px-4 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                >
                  <span>Continuar</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 4: TEAM */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div className="space-y-1">
                <h3 className="text-lg font-bold text-foreground">4. Convidar Equipe Comercial</h3>
                <p className="text-xs text-muted-foreground">
                  Adicione seus vendedores e gestores para atender conversas e acompanhar os resultados.
                </p>
              </div>

              {/* Roles Explanation */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                  <span className="font-bold text-xs text-foreground block">Gestor (Admin)</span>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Acesso ao Cockpit Operacional, fila de atenção, métricas de equipe e configurações.
                  </p>
                </div>
                <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                  <span className="font-bold text-xs text-foreground block">Vendedor (Agent)</span>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Foco nas conversas diárias, gestão de follow-ups e assistência do Copiloto.
                  </p>
                </div>
                <div className="p-3 rounded-lg border border-border bg-muted/20 space-y-1">
                  <span className="font-bold text-xs text-foreground block">Visualizador (Viewer)</span>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Acesso de leitura às conversas e tarefas sem permissão de envio.
                  </p>
                </div>
              </div>

              {/* Invite Box */}
              <div className="p-4 rounded-xl border border-border bg-muted/20 space-y-3">
                <span className="text-xs font-semibold text-foreground block">
                  Enviar convite por e-mail
                </span>
                <div className="flex flex-col sm:flex-row gap-2">
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="email@suaempresa.com"
                    className="h-8.5 text-xs bg-background border-border flex-1"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as any)}
                    className="h-8.5 text-xs bg-background border border-border rounded-md px-2 text-foreground"
                  >
                    <option value="agent">Vendedor (Agent)</option>
                    <option value="admin">Gestor (Admin)</option>
                    <option value="viewer">Visualizador (Viewer)</option>
                  </select>
                  <Button
                    size="sm"
                    onClick={handleInviteMember}
                    disabled={!inviteEmail.trim() || saving}
                    className="h-8.5 text-xs font-semibold gap-1 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                  >
                    Convidar
                  </Button>
                </div>

                {invitedMembers.length > 0 && (
                  <div className="pt-2 space-y-1">
                    <span className="text-[11px] font-semibold text-muted-foreground">Convites enviados:</span>
                    <ul className="text-xs text-foreground list-disc list-inside">
                      {invitedMembers.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/60">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(3)}
                  className="text-xs text-muted-foreground"
                >
                  <ArrowLeft className="size-3.5 mr-1" />
                  Voltar
                </Button>

                <Button
                  onClick={() => setCurrentStep(5)}
                  className="h-9 px-4 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white"
                >
                  <span>Continuar</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}

          {/* STEP 5: INTELLIGENCE & CONCLUSION */}
          {currentStep === 5 && (
            <div className="space-y-6">
              <div className="text-center space-y-2 py-2">
                <div className="size-12 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 mx-auto">
                  <Sparkles className="size-6 text-[#D16A3A]" />
                </div>
                <h3 className="text-xl font-bold text-foreground">
                  Seu Ciclopes está pronto!
                </h3>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  O motor de inteligência comercial está ativo e configurado com o modelo canônico do Google Gemini.
                </p>
              </div>

              {/* Highlights */}
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-primary font-sans block">
                  Capacidades Ativas no Workspace
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-foreground">Lead Scoring Determinístico:</strong> Pontuação de 0 a 100 baseada em sinais e intenções reais.
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-foreground">Copiloto Comercial:</strong> Sugestões de resposta e superação de objeções com 1 clique.
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-foreground">Fila de Atenção:</strong> Alertas para o gestor quando leads quentes estiverem parados.
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <CheckCircle2 className="size-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <strong className="text-foreground">Privacidade e Governança:</strong> Zero envio de dados pessoais desnecessários.
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-4 border-t border-border/60">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(4)}
                  className="text-xs text-muted-foreground"
                >
                  <ArrowLeft className="size-3.5 mr-1" />
                  Voltar
                </Button>

                <Button
                  onClick={handleFinishOnboarding}
                  className="h-9 px-5 text-xs font-semibold gap-1.5 bg-[#1E3A5F] hover:bg-[#162B46] text-white shadow-sm"
                >
                  <span>{isManager ? "Ir para o Cockpit" : "Ir para as Conversas"}</span>
                  <ArrowRight className="size-3.5" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

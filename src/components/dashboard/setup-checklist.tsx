"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  Eye,
  GitBranch,
  Package,
  QrCode,
  Sparkles,
  Users,
} from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface SetupState {
  whatsappConnected: boolean;
  hasTeam: boolean;
  hasCatalog: boolean;
  hasPipeline: boolean;
  hasAiConfig: boolean;
  hasAnalyzedConversation: boolean;
}

const EMPTY_STATE: SetupState = {
  whatsappConnected: false,
  hasTeam: false,
  hasCatalog: false,
  hasPipeline: false,
  hasAiConfig: false,
  hasAnalyzedConversation: false,
};

interface SetupItem {
  key: keyof SetupState;
  title: string;
  description: string;
  href: string;
  cta: string;
  icon: typeof QrCode;
}

const ITEMS: SetupItem[] = [
  {
    key: "whatsappConnected",
    title: "1. Conectar WhatsApp",
    description: "Conecte sua sessão via WAHA ou Meta API para receber e responder conversas.",
    href: "/settings?tab=whatsapp",
    cta: "Conectar WhatsApp",
    icon: QrCode,
  },
  {
    key: "hasTeam",
    title: "2. Adicionar equipe comercial",
    description: "Convide seus consultores e atendentes para gerenciar os atendimentos.",
    href: "/settings?tab=members",
    cta: "Convidar equipe",
    icon: Users,
  },
  {
    key: "hasCatalog",
    title: "3. Cadastrar catálogo de produtos & serviços",
    description: "Cadastre seus itens para que o Ciclopes reconheça interesses nas conversas.",
    href: "/catalog",
    cta: "Configurar catálogo",
    icon: Package,
  },
  {
    key: "hasPipeline",
    title: "4. Estruturar funil e etapas do pipeline",
    description: "Defina as etapas da sua jornada de vendas para acompanhar negócios.",
    href: "/pipelines",
    cta: "Ajustar pipeline",
    icon: GitBranch,
  },
  {
    key: "hasAiConfig",
    title: "5. Configurar inteligência interna",
    description: "Ative sua OpenAI API Key e defina o modelo para síntese e extração sob demanda.",
    href: "/settings?tab=ai-config",
    cta: "Configurar IA",
    icon: Sparkles,
  },
  {
    key: "hasAnalyzedConversation",
    title: "6. Analisar primeira conversa",
    description: "Abra uma conversa no Inbox e clique em 'Analisar Conversa' para extrair sinais.",
    href: "/inbox",
    cta: "Abrir conversas",
    icon: Eye,
  },
];

export function SetupChecklist() {
  const [state, setState] = useState<SetupState>(EMPTY_STATE);
  const [loading, setLoading] = useState(true);

  const loadStatus = useCallback(async () => {
    try {
      const db = createClient();
      const {
        data: { session },
      } = await db.auth.getSession();
      if (!session) return;

      const [wahaRes, membersRes, catalogRes, pipelineRes, aiRes, analysisRes] = await Promise.all([
        db.from("whatsapp_configs").select("status").limit(1),
        db.from("account_members").select("id").limit(2),
        db.from("catalog_items").select("id").limit(1),
        db.from("pipelines").select("id").limit(1),
        db.from("account_ai_configs").select("is_enabled").limit(1),
        db.from("conversation_insights").select("id").limit(1),
      ]);

      setState({
        whatsappConnected: Boolean(wahaRes.data && wahaRes.data.length > 0 && wahaRes.data[0].status === "connected"),
        hasTeam: Boolean(membersRes.data && membersRes.data.length > 1),
        hasCatalog: Boolean(catalogRes.data && catalogRes.data.length > 0),
        hasPipeline: Boolean(pipelineRes.data && pipelineRes.data.length > 0),
        hasAiConfig: Boolean(aiRes.data && aiRes.data.length > 0 && aiRes.data[0].is_enabled),
        hasAnalyzedConversation: Boolean(analysisRes.data && analysisRes.data.length > 0),
      });
    } catch (err) {
      console.error("[setup-checklist] fetch failed:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const completedCount = useMemo(() => {
    return Object.values(state).filter(Boolean).length;
  }, [state]);

  const progressPercent = Math.round((completedCount / ITEMS.length) * 100);

  // If fully completed, we don't show the checklist
  if (!loading && completedCount === ITEMS.length) {
    return null;
  }

  return (
    <Card className="border-border bg-card shadow-sm overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div>
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <span className="text-[#D16A3A] font-bold">Guia de Ativação</span> — Ciclopes
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Conclua os passos essenciais para transformar suas conversas em inteligência de vendas
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              {completedCount} de {ITEMS.length} concluídos ({progressPercent}%)
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full bg-gradient-to-r from-[#1E3A5F] to-[#D16A3A] transition-all duration-500 rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </CardHeader>

      <CardContent className="pt-1 pb-4">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ITEMS.map((item) => {
            const isDone = state[item.key];
            const Icon = item.icon;

            return (
              <div
                key={item.key}
                className={cn(
                  "flex flex-col justify-between rounded-lg border p-3.5 transition-all",
                  isDone
                    ? "border-emerald-500/30 bg-emerald-500/5 text-muted-foreground"
                    : "border-border bg-card/60 hover:border-primary/40 hover:bg-card"
                )}
              >
                <div>
                  <div className="flex items-start justify-between gap-2 mb-1.5">
                    <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                      {item.title}
                    </span>
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground/40 shrink-0" />
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    {item.description}
                  </p>
                </div>

                <div className="mt-3 flex items-center justify-between pt-2 border-t border-border/40">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Icon className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <Link
                    href={item.href}
                    className={cn(
                      "text-xs font-semibold hover:underline",
                      isDone ? "text-muted-foreground" : "text-[#D16A3A]"
                    )}
                  >
                    {isDone ? "Revisar" : item.cta + " →"}
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';

export async function POST(req: Request) {
  try {
    await getCurrentAccount();
    const body = await req.json();

    const {
      baseScore = 10,
      intent = 'purchase',
      urgency = 'high',
      hasInterest = true,
      hasBudgetMatch = true,
      hasObjection = false,
      rules = {},
    } = body;

    const breakdown: Record<string, { points: number; rule: string; matched: boolean }> = {};
    let currentScore = Number(baseScore) || 10;

    breakdown['base_score'] = {
      points: currentScore,
      rule: 'Pontuação Base de Início',
      matched: true,
    };

    // 1. Intent bonus
    const intentWeight = rules['intent_purchase'] ?? 30;
    if (intent === 'purchase') {
      currentScore += intentWeight;
      breakdown['intent'] = {
        points: intentWeight,
        rule: 'Intenção Comercial Clara (Compra)',
        matched: true,
      };
    }

    // 2. Urgency bonus
    const urgencyWeight = rules['urgency_high'] ?? 20;
    if (urgency === 'high') {
      currentScore += urgencyWeight;
      breakdown['urgency'] = {
        points: urgencyWeight,
        rule: 'Alta Urgência Detectada',
        matched: true,
      };
    } else if (urgency === 'medium') {
      const medWeight = rules['urgency_medium'] ?? 10;
      currentScore += medWeight;
      breakdown['urgency'] = {
        points: medWeight,
        rule: 'Média Urgência Detectada',
        matched: true,
      };
    }

    // 3. Catalog Interest bonus
    const catalogWeight = rules['catalog_interest'] ?? 20;
    if (hasInterest) {
      currentScore += catalogWeight;
      breakdown['catalog_interest'] = {
        points: catalogWeight,
        rule: 'Interesse em Produto / Serviço do Catálogo',
        matched: true,
      };
    }

    // 4. Budget Match bonus
    const budgetWeight = rules['budget_match'] ?? 15;
    if (hasBudgetMatch) {
      currentScore += budgetWeight;
      breakdown['budget_match'] = {
        points: budgetWeight,
        rule: 'Compatibilidade de Orçamento / Condições',
        matched: true,
      };
    }

    // 5. Objection penalty
    const objectionPenalty = rules['objection_penalty'] ?? -15;
    if (hasObjection) {
      currentScore += objectionPenalty;
      breakdown['objection'] = {
        points: objectionPenalty,
        rule: 'Objeção Ativa Identificada',
        matched: true,
      };
    }

    // Clamp between 0 and 100
    const finalScore = Math.max(0, Math.min(100, currentScore));

    return NextResponse.json({
      score: finalScore,
      breakdown,
      qualification:
        finalScore >= 70 ? 'Hot Lead 🔥' : finalScore >= 40 ? 'Warm Lead ⚡' : 'Cold Lead ❄️',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

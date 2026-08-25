import type { SupabaseClient } from '@supabase/supabase-js';
import { validateUuid } from '@/lib/leads/validation';

export interface StageDealCount {
  stageId: string;
  stageName: string;
  stageOrder: number;
  dealCount: number;
  totalValue: number;
}

export interface PipelineStageCountResult {
  pipelineId: string;
  pipelineName: string;
  stages: StageDealCount[];
  totalDeals: number;
  totalPipelineValue: number;
}

interface DealRow {
  stage_id: string;
  value: number | string | null;
}

interface StageRow {
  id: string;
  name: string;
  sort_order: number;
}

export async function getPipelineStageCounts(
  db: SupabaseClient,
  accountId: string,
  pipelineId?: string | null
): Promise<PipelineStageCountResult | null> {
  const validAccId = validateUuid(accountId, 'accountId');

  // 1. Resolve target pipeline
  let pipelineQuery = db
    .from('pipelines')
    .select('id, name')
    .eq('account_id', validAccId);

  if (pipelineId) {
    pipelineQuery = pipelineQuery.eq('id', validateUuid(pipelineId, 'pipelineId'));
  }

  const { data: pipelineData } = await pipelineQuery.order('created_at', { ascending: true }).limit(1).maybeSingle();

  if (!pipelineData) {
    return null;
  }

  const resolvedPipelineId = pipelineData.id;
  const pipelineName = pipelineData.name;

  // 2. Fetch stages
  const { data: stagesData } = await db
    .from('pipeline_stages')
    .select('id, name, sort_order')
    .eq('account_id', validAccId)
    .eq('pipeline_id', resolvedPipelineId)
    .order('sort_order', { ascending: true });

  const stages = (stagesData || []) as unknown as StageRow[];

  // 3. Fetch deals for these stages
  const { data: dealsData } = await db
    .from('deals')
    .select('stage_id, value')
    .eq('account_id', validAccId)
    .eq('pipeline_id', resolvedPipelineId)
    .eq('status', 'open');

  const deals = (dealsData || []) as unknown as DealRow[];

  // 4. Aggregate counts
  let totalDeals = 0;
  let totalPipelineValue = 0;

  const stageCounts: StageDealCount[] = stages.map((st) => {
    const stageDeals = deals.filter((d) => d.stage_id === st.id);
    const dealCount = stageDeals.length;
    const stageValue = stageDeals.reduce((sum, d) => sum + (Number(d.value) || 0), 0);

    totalDeals += dealCount;
    totalPipelineValue += stageValue;

    return {
      stageId: st.id,
      stageName: st.name,
      stageOrder: st.sort_order,
      dealCount,
      totalValue: stageValue,
    };
  });

  return {
    pipelineId: resolvedPipelineId,
    pipelineName,
    stages: stageCounts,
    totalDeals,
    totalPipelineValue,
  };
}

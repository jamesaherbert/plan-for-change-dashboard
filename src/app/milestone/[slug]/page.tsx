import { notFound } from "next/navigation";
import { getMilestone, MILESTONE_SLUGS } from "@/lib/milestones";
import { initDb, getDb } from "@/lib/db";
import type {
  MilestoneSlug,
  KpiSnapshot,
  Output,
  MediaArticle,
  CommitteeInquiry,
  Debate,
  BillStage,
} from "@/lib/types";
import KpiDetail from "@/components/kpi/KpiDetail";
import OutputCard from "@/components/outputs/OutputCard";
import KeyOutputsPanel from "@/components/outputs/KeyOutputsPanel";
import Collapsible from "@/components/ui/Collapsible";
import ArticleCard from "@/components/media/ArticleCard";
import DebateItem from "@/components/parliamentary/DebateItem";
import CommitteeCard from "@/components/parliamentary/CommitteeCard";
import MilestoneBriefing from "@/components/milestone/MilestoneBriefing";

export function generateStaticParams() {
  return MILESTONE_SLUGS.map((slug) => ({ slug }));
}

function queryDb<T>(sql: string, ...params: unknown[]): T[] {
  try {
    const db = getDb();
    return db.prepare(sql).all(...params) as T[];
  } catch {
    return [];
  }
}

function queryOne<T>(sql: string, ...params: unknown[]): T | undefined {
  try {
    const db = getDb();
    return db.prepare(sql).get(...params) as T | undefined;
  } catch {
    return undefined;
  }
}

export default async function MilestonePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  if (!MILESTONE_SLUGS.includes(slug as MilestoneSlug)) {
    notFound();
  }

  try {
    initDb();
  } catch {
    // DB might not be accessible during build
  }

  const milestone = getMilestone(slug as MilestoneSlug);

  const kpiHistory = queryDb<KpiSnapshot>(
    "SELECT milestone_slug as milestoneSlug, value, date, label, fetched_at as fetchedAt FROM kpi_snapshots WHERE milestone_slug = ? ORDER BY date ASC",
    slug
  );

  const briefing = queryOne<{ content: string; generatedAt: string }>(
    "SELECT content, generated_at as generatedAt FROM milestone_briefings WHERE milestone_slug = ?",
    slug
  );

  const outputs = queryDb<Output>(
    `SELECT id, milestone_slug as milestoneSlug, type, title, description, url, source, status,
     published_date as publishedDate, last_updated as lastUpdated, department, confidence, dismissed,
     rationale, rationale_updated_at as rationaleUpdatedAt,
     (SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = outputs.id) as mediaArticleCount,
     (SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = outputs.id AND ma.published_date >= date('now', '-7 days')) as recentMediaCount
     FROM outputs WHERE milestone_slug = ? AND dismissed = 0 ORDER BY last_updated DESC`,
    slug
  );

  // Key outputs: top scored for this milestone
  const keyOutputs = queryDb<Output>(
    `SELECT
      o.id, o.milestone_slug as milestoneSlug, o.type, o.title, o.description,
      o.url, o.source, o.status, o.published_date as publishedDate,
      o.last_updated as lastUpdated, o.department, o.confidence, o.dismissed,
      o.rationale, o.rationale_updated_at as rationaleUpdatedAt,
      (SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = o.id) as mediaArticleCount,
      (SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = o.id AND ma.published_date >= date('now', '-7 days')) as recentMediaCount,
      (
        CASE o.type
          WHEN 'bill' THEN 10
          WHEN 'white_paper' THEN 9
          WHEN 'policy_paper' THEN 8
          WHEN 'consultation' THEN 6
          WHEN 'framework' THEN 5
          WHEN 'action_plan' THEN 5
          WHEN 'government_response' THEN 4
          WHEN 'committee_report' THEN 3
          ELSE 1
        END
        -- Current parliament bonus (introduced after Jul 2024)
        + CASE WHEN o.published_date >= '2024-07-01' THEN 15 ELSE 0 END
        -- Recency bonus
        + CASE
          WHEN o.last_updated >= date('now', '-90 days') THEN 5
          WHEN o.last_updated >= date('now', '-180 days') THEN 3
          ELSE 0
        END
        -- Pre-2024 penalty (old acts from previous parliaments)
        + CASE WHEN o.published_date < '2024-01-01' THEN -15 ELSE 0 END
        -- Bill progress (capped to avoid old enacted bills dominating)
        + MIN(COALESCE((SELECT COUNT(*) FROM bill_stages bs WHERE bs.output_id = o.id AND bs.completed = 1), 0), 5) * 2
        + CASE WHEN EXISTS(SELECT 1 FROM bill_stages bs WHERE bs.output_id = o.id AND bs.name = 'Royal Assent') THEN 5 ELSE 0 END
        -- Media coverage bonus (capped at 5)
        + MIN(COALESCE((SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = o.id), 0), 5)
      ) as score
    FROM outputs o
    WHERE o.milestone_slug = ?
      AND o.dismissed = 0
      AND o.type NOT IN ('guidance', 'impact_assessment', 'statutory_instrument')
      AND o.published_date >= '2023-01-01'
    ORDER BY score DESC
    LIMIT 10`,
    slug
  );
  const keyOutputIds = new Set(keyOutputs.map((o) => o.id));
  const remainingOutputs = outputs.filter((o) => !keyOutputIds.has(o.id));

  // Build a map of output_id → BillStage[] for bill-type outputs
  const billStageRows = queryDb<BillStage & { outputId: string }>(
    `SELECT bs.output_id as outputId, bs.name, bs.house, bs.date, bs.completed
     FROM bill_stages bs
     JOIN outputs o ON o.id = bs.output_id
     WHERE o.milestone_slug = ? AND o.type = 'bill' AND o.dismissed = 0
     ORDER BY bs.id ASC`,
    slug
  );
  const billStagesMap = new Map<string, BillStage[]>();
  for (const row of billStageRows) {
    const stages = billStagesMap.get(row.outputId) ?? [];
    stages.push({
      name: row.name,
      house: row.house,
      date: row.date,
      completed: Boolean(row.completed),
    });
    billStagesMap.set(row.outputId, stages);
  }

  // Build map of output_id → latest media article for key outputs
  const latestArticlesMap = new Map<string, MediaArticle>();
  if (keyOutputIds.size > 0) {
    const placeholders = [...keyOutputIds].map(() => "?").join(",");
    const latestArticles = queryDb<MediaArticle & { outputId: string }>(
      `SELECT ma.id, ma.milestone_slug as milestoneSlug, ma.output_id as outputId,
       ma.title, ma.url, ma.source, ma.published_date as publishedDate,
       ma.excerpt, ma.thumbnail_url as thumbnailUrl, ma.api_source as apiSource,
       ma.fetched_at as fetchedAt
       FROM media_articles ma
       WHERE ma.output_id IN (${placeholders})
       ORDER BY ma.published_date DESC`,
      ...[...keyOutputIds]
    );
    for (const article of latestArticles) {
      if (article.outputId && !latestArticlesMap.has(article.outputId)) {
        latestArticlesMap.set(article.outputId, article);
      }
    }
  }

  const debates = queryDb<Debate>(
    "SELECT id, milestone_slug as milestoneSlug, title, date, house, url, source FROM debates WHERE milestone_slug = ? ORDER BY date DESC LIMIT 20",
    slug
  );

  const committees = queryDb<CommitteeInquiry>(
    `SELECT id, milestone_slug as milestoneSlug, committee_name as committeeName, committee_id as committeeId,
     inquiry_title as inquiryTitle, status, url, evidence_sessions as evidenceSessions,
     reports_published as reportsPublished, last_activity as lastActivity
     FROM committee_inquiries WHERE milestone_slug = ? ORDER BY last_activity DESC`,
    slug
  );

  const mediaArticles = queryDb<MediaArticle>(
    `SELECT id, milestone_slug as milestoneSlug, output_id as outputId, title, url, source,
     published_date as publishedDate, excerpt, thumbnail_url as thumbnailUrl,
     api_source as apiSource, fetched_at as fetchedAt
     FROM media_articles WHERE milestone_slug = ? ORDER BY published_date DESC LIMIT 30`,
    slug
  );

  const generalMedia = mediaArticles.filter((a) => !a.outputId);

  return (
    <div className="p-6 max-w-5xl">
      {/* Panel 1: KPI Status */}
      <KpiDetail milestone={milestone} kpiHistory={kpiHistory} />

      {/* AI Briefing */}
      {briefing && (
        <div className="mt-6">
          <MilestoneBriefing
            content={briefing.content}
            generatedAt={briefing.generatedAt}
          />
        </div>
      )}

      {/* Key Outputs Panel — full width below KPI */}
      {keyOutputs.length > 0 && (
        <div className="mt-6">
          <KeyOutputsPanel
            outputs={keyOutputs}
            billStagesMap={billStagesMap}
            latestArticlesMap={latestArticlesMap}
          />
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
        {/* Panel 2: All Outputs Pipeline (wider, collapsed by default) */}
        <div className="lg:col-span-3">
          <Collapsible
            title="All Outputs"
            count={remainingOutputs.length}
            defaultOpen={false}
          >
            {remainingOutputs.length > 0 ? (
              <div className="space-y-3">
                {remainingOutputs.map((output) => (
                  <OutputCard
                    key={output.id}
                    output={output}
                    billStages={billStagesMap.get(output.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No additional outputs beyond the key ones above." />
            )}
          </Collapsible>

          {/* Media Overview below outputs */}
          <div className="bg-white rounded-xl border border-[var(--border)] p-5 mt-6">
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-4">
              Media Coverage
            </h3>
            {generalMedia.length > 0 ? (
              <div>
                {generalMedia.slice(0, 10).map((article) => (
                  <ArticleCard key={article.id} article={article} />
                ))}
              </div>
            ) : (
              <EmptyState message="No media articles yet. Set up your Guardian API key and run the media fetch script." />
            )}
          </div>
        </div>

        {/* Panel 3: Parliamentary Scrutiny (narrower) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Committees */}
          <div className="bg-white rounded-xl border border-[var(--border)] p-5">
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-4">
              Committee Inquiries
            </h3>
            {committees.length > 0 ? (
              <div className="space-y-3">
                {committees.map((inquiry) => (
                  <CommitteeCard key={inquiry.id} inquiry={inquiry} />
                ))}
              </div>
            ) : (
              <EmptyState message="No committee inquiries tracked yet." />
            )}
          </div>

          {/* Debates */}
          <div className="bg-white rounded-xl border border-[var(--border)] p-5">
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-4">
              Recent Debates
            </h3>
            {debates.length > 0 ? (
              <div>
                {debates.map((debate) => (
                  <DebateItem key={debate.id} debate={debate} />
                ))}
              </div>
            ) : (
              <EmptyState message="No debates tracked yet." />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-8 text-center">
      <p className="text-sm text-[var(--muted)]">{message}</p>
    </div>
  );
}

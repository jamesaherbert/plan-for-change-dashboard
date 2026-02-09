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
import ArticleCard from "@/components/media/ArticleCard";
import DebateItem from "@/components/parliamentary/DebateItem";
import CommitteeCard from "@/components/parliamentary/CommitteeCard";

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

  const outputs = queryDb<Output>(
    `SELECT id, milestone_slug as milestoneSlug, type, title, description, url, source, status,
     published_date as publishedDate, last_updated as lastUpdated, department, confidence, dismissed,
     (SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = outputs.id) as mediaArticleCount,
     (SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = outputs.id AND ma.published_date >= date('now', '-7 days')) as recentMediaCount
     FROM outputs WHERE milestone_slug = ? AND dismissed = 0 ORDER BY last_updated DESC`,
    slug
  );

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

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 mt-6">
        {/* Panel 2: Outputs Pipeline (wider) */}
        <div className="lg:col-span-3">
          <div className="bg-white rounded-xl border border-[var(--border)] p-5">
            <h3 className="text-base font-semibold text-[var(--foreground)] mb-4">
              Outputs Pipeline
            </h3>
            {outputs.length > 0 ? (
              <div className="space-y-3">
                {outputs.map((output) => (
                  <OutputCard
                    key={output.id}
                    output={output}
                    billStages={billStagesMap.get(output.id)}
                  />
                ))}
              </div>
            ) : (
              <EmptyState message="No outputs tracked yet. Run the data refresh script to fetch policy papers, bills, and consultations." />
            )}
          </div>

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

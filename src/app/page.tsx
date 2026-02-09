import { getAllMilestones } from "@/lib/milestones";
import { initDb, getDb } from "@/lib/db";
import KpiCard from "@/components/kpi/KpiCard";
import type { KpiSnapshot, Output, MediaArticle, MilestoneSlug } from "@/lib/types";
import { getMEFramework } from "@/lib/me-framework";
import { enrichDeliverables } from "@/lib/me-matching";

function getKpiHistory(milestoneSlug: string): KpiSnapshot[] {
  try {
    const db = getDb();
    return db
      .prepare(
        "SELECT milestone_slug as milestoneSlug, value, date, label, fetched_at as fetchedAt FROM kpi_snapshots WHERE milestone_slug = ? ORDER BY date ASC"
      )
      .all(milestoneSlug) as KpiSnapshot[];
  } catch {
    return [];
  }
}

function getMESummary(milestoneSlug: string): { delivered: number; total: number; atRisk: number } | undefined {
  const framework = getMEFramework(milestoneSlug as MilestoneSlug);
  if (!framework) return undefined;

  try {
    const db = getDb();
    const outputs = db
      .prepare(
        `SELECT id, milestone_slug as milestoneSlug, type, title, description, url, source, status,
         published_date as publishedDate, last_updated as lastUpdated, department, confidence, dismissed,
         rationale, rationale_updated_at as rationaleUpdatedAt
         FROM outputs WHERE milestone_slug = ? AND dismissed = 0`
      )
      .all(milestoneSlug) as Output[];

    const media = db
      .prepare(
        `SELECT id, milestone_slug as milestoneSlug, output_id as outputId, title, url, source,
         published_date as publishedDate, excerpt, thumbnail_url as thumbnailUrl,
         api_source as apiSource, fetched_at as fetchedAt
         FROM media_articles WHERE milestone_slug = ? ORDER BY published_date DESC LIMIT 50`
      )
      .all(milestoneSlug) as MediaArticle[];

    const view = enrichDeliverables(framework, outputs, media);
    return {
      delivered: view.deliveredCount,
      total: view.enrichedDeliverables.length,
      atRisk: view.atRiskCount,
    };
  } catch {
    return undefined;
  }
}

function getOverviewStats(milestoneSlug: string) {
  try {
    const db = getDb();
    const outputCount = (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM outputs WHERE milestone_slug = ? AND dismissed = 0"
        )
        .get(milestoneSlug) as { count: number }
    ).count;

    const recentMediaCount = (
      db
        .prepare(
          "SELECT COUNT(*) as count FROM media_articles WHERE milestone_slug = ? AND published_date >= date('now', '-7 days')"
        )
        .get(milestoneSlug) as { count: number }
    ).count;

    return { outputCount, recentMediaCount };
  } catch {
    return { outputCount: 0, recentMediaCount: 0 };
  }
}

export default function OverviewPage() {
  try {
    initDb();
  } catch {
    // DB might not be accessible during build
  }

  const milestones = getAllMilestones();

  return (
    <div className="p-6 max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-[var(--foreground)]">
          Plan for Change
        </h1>
        <p className="text-sm text-[var(--muted)] mt-1">
          Tracking the UK Government&apos;s 6 milestones for mission-led
          government (Dec 2024 — Spring 2029)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {milestones.map((milestone) => {
          const kpiHistory = getKpiHistory(milestone.slug);
          const latestKpi =
            kpiHistory.length > 0
              ? kpiHistory[kpiHistory.length - 1]
              : undefined;
          const stats = getOverviewStats(milestone.slug);
          const meSummary = getMESummary(milestone.slug);

          return (
            <KpiCard
              key={milestone.slug}
              milestone={milestone}
              latestKpi={latestKpi}
              kpiHistory={kpiHistory}
              outputCount={stats.outputCount}
              recentMediaCount={stats.recentMediaCount}
              meSummary={meSummary}
            />
          );
        })}
      </div>
    </div>
  );
}

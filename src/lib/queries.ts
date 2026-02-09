import { getDb } from "./db";
import type {
  MilestoneSlug,
  KpiSnapshot,
  Output,
  MediaArticle,
  Debate,
  CommitteeInquiry,
  BillStage,
} from "./types";

// ---------------------------------------------------------------------------
// Row-to-model mappers (DB uses snake_case, TS uses camelCase)
// ---------------------------------------------------------------------------

function mapKpiRow(row: Record<string, unknown>): KpiSnapshot {
  return {
    id: row.id as number,
    milestoneSlug: row.milestone_slug as MilestoneSlug,
    value: row.value as number,
    date: row.date as string,
    label: (row.label as string) ?? undefined,
    fetchedAt: row.fetched_at as string,
  };
}

function mapOutputRow(row: Record<string, unknown>): Output {
  return {
    id: row.id as string,
    milestoneSlug: row.milestone_slug as MilestoneSlug,
    type: row.type as Output["type"],
    title: row.title as string,
    description: (row.description as string) ?? "",
    url: row.url as string,
    source: row.source as Output["source"],
    status: (row.status as string) ?? "",
    publishedDate: (row.published_date as string) ?? "",
    lastUpdated: (row.last_updated as string) ?? "",
    department: (row.department as string) ?? undefined,
    confidence: row.confidence as Output["confidence"],
    dismissed: Boolean(row.dismissed),
  };
}

function mapMediaRow(row: Record<string, unknown>): MediaArticle {
  return {
    id: row.id as string,
    milestoneSlug: row.milestone_slug as MilestoneSlug,
    outputId: (row.output_id as string) ?? undefined,
    title: row.title as string,
    url: row.url as string,
    source: row.source as string,
    publishedDate: (row.published_date as string) ?? "",
    excerpt: (row.excerpt as string) ?? undefined,
    thumbnailUrl: (row.thumbnail_url as string) ?? undefined,
    apiSource: row.api_source as MediaArticle["apiSource"],
    fetchedAt: row.fetched_at as string,
  };
}

function mapDebateRow(row: Record<string, unknown>): Debate {
  return {
    id: row.id as string,
    milestoneSlug: row.milestone_slug as MilestoneSlug,
    title: row.title as string,
    date: row.date as string,
    house: row.house as Debate["house"],
    url: row.url as string,
    source: row.source as Debate["source"],
  };
}

function mapCommitteeRow(row: Record<string, unknown>): CommitteeInquiry {
  return {
    id: row.id as string,
    milestoneSlug: row.milestone_slug as MilestoneSlug,
    committeeName: row.committee_name as string,
    committeeId: row.committee_id as number,
    inquiryTitle: row.inquiry_title as string,
    status: row.status as CommitteeInquiry["status"],
    url: (row.url as string) ?? "",
    evidenceSessions: (row.evidence_sessions as number) ?? 0,
    reportsPublished: (row.reports_published as number) ?? 0,
    lastActivity: (row.last_activity as string) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Query functions
// ---------------------------------------------------------------------------

/**
 * Get all KPI snapshots for a milestone, ordered by date ascending.
 */
export function getKpiHistory(milestoneSlug: MilestoneSlug): KpiSnapshot[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM kpi_snapshots WHERE milestone_slug = ? ORDER BY date ASC`
    )
    .all(milestoneSlug) as Record<string, unknown>[];
  return rows.map(mapKpiRow);
}

/**
 * Get the most recent KPI snapshot for a milestone.
 */
export function getLatestKpi(
  milestoneSlug: MilestoneSlug
): KpiSnapshot | undefined {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM kpi_snapshots WHERE milestone_slug = ? ORDER BY date DESC LIMIT 1`
    )
    .get(milestoneSlug) as Record<string, unknown> | undefined;
  return row ? mapKpiRow(row) : undefined;
}

/**
 * Get all non-dismissed outputs for a milestone, ordered by last_updated descending.
 */
export function getOutputs(milestoneSlug: MilestoneSlug): Output[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM outputs
       WHERE milestone_slug = ? AND dismissed = 0
       ORDER BY last_updated DESC`
    )
    .all(milestoneSlug) as Record<string, unknown>[];
  return rows.map(mapOutputRow);
}

/**
 * Get media articles for a milestone, newest first.
 */
export function getMediaForMilestone(
  milestoneSlug: MilestoneSlug,
  limit: number = 50
): MediaArticle[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM media_articles
       WHERE milestone_slug = ?
       ORDER BY published_date DESC
       LIMIT ?`
    )
    .all(milestoneSlug, limit) as Record<string, unknown>[];
  return rows.map(mapMediaRow);
}

/**
 * Get media articles linked to a specific output.
 */
export function getMediaForOutput(outputId: string): MediaArticle[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM media_articles
       WHERE output_id = ?
       ORDER BY published_date DESC`
    )
    .all(outputId) as Record<string, unknown>[];
  return rows.map(mapMediaRow);
}

/**
 * Get debates for a milestone, newest first.
 */
export function getDebates(
  milestoneSlug: MilestoneSlug,
  limit: number = 20
): Debate[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM debates
       WHERE milestone_slug = ?
       ORDER BY date DESC
       LIMIT ?`
    )
    .all(milestoneSlug, limit) as Record<string, unknown>[];
  return rows.map(mapDebateRow);
}

/**
 * Get committee inquiries for a milestone.
 */
export function getCommitteeInquiries(
  milestoneSlug: MilestoneSlug
): CommitteeInquiry[] {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT * FROM committee_inquiries
       WHERE milestone_slug = ?
       ORDER BY last_activity DESC`
    )
    .all(milestoneSlug) as Record<string, unknown>[];
  return rows.map(mapCommitteeRow);
}

/**
 * Get aggregate stats for the milestone overview page.
 */
export function getOverviewStats(
  milestoneSlug: MilestoneSlug
): { outputCount: number; recentMediaCount: number; billCount: number } {
  const db = getDb();

  const outputCount = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM outputs
         WHERE milestone_slug = ? AND dismissed = 0`
      )
      .get(milestoneSlug) as { cnt: number }
  ).cnt;

  const recentMediaCount = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM media_articles
         WHERE milestone_slug = ?
           AND published_date >= date('now', '-7 days')`
      )
      .get(milestoneSlug) as { cnt: number }
  ).cnt;

  const billCount = (
    db
      .prepare(
        `SELECT COUNT(*) as cnt FROM outputs
         WHERE milestone_slug = ? AND type = 'bill' AND dismissed = 0`
      )
      .get(milestoneSlug) as { cnt: number }
  ).cnt;

  return { outputCount, recentMediaCount, billCount };
}

/**
 * Get all bill stages for bill-type outputs in a milestone.
 * Returns a map of outputId → BillStage[].
 */
export function getBillStagesForMilestone(
  milestoneSlug: MilestoneSlug
): Map<string, BillStage[]> {
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT bs.output_id, bs.name, bs.house, bs.date, bs.completed
       FROM bill_stages bs
       JOIN outputs o ON o.id = bs.output_id
       WHERE o.milestone_slug = ? AND o.type = 'bill' AND o.dismissed = 0
       ORDER BY bs.id ASC`
    )
    .all(milestoneSlug) as Record<string, unknown>[];

  const map = new Map<string, BillStage[]>();
  for (const row of rows) {
    const outputId = row.output_id as string;
    const stage: BillStage = {
      name: row.name as string,
      house: row.house as "Commons" | "Lords",
      date: (row.date as string) ?? undefined,
      completed: Boolean(row.completed),
    };
    const existing = map.get(outputId);
    if (existing) {
      existing.push(stage);
    } else {
      map.set(outputId, [stage]);
    }
  }
  return map;
}

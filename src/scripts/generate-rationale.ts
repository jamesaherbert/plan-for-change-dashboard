import Anthropic from "@anthropic-ai/sdk";
import { getDb, initDb } from "../lib/db";
import { getMilestone, MILESTONE_SLUGS } from "../lib/milestones";
import type { MilestoneSlug } from "../lib/types";

const TOP_N = 10;

interface ScoredOutput {
  id: string;
  milestoneSlug: string;
  type: string;
  title: string;
  description: string;
  status: string;
  department: string | null;
  publishedDate: string | null;
  lastUpdated: string | null;
  rationale: string | null;
  rationaleUpdatedAt: string | null;
  lastUpdatedTs: string | null;
  mediaCount: number;
  billStageCount: number;
  hasRoyalAssent: number;
  score: number;
}

/**
 * Score and return top outputs for a milestone using SQL-level heuristic.
 *
 * Scoring:
 * - Type weight: bill=10, white_paper=9, policy_paper=8, consultation=6, framework=5, action_plan=5
 * - Recency: +5 if updated in last 90 days, +3 if last 180 days
 * - Bill stage bonus: +3 per stage completed, +10 for Royal Assent
 * - Media count: +1 per article, capped at +5
 * - Exclude: guidance, impact_assessment, statutory_instrument (low signal)
 */
export function getTopOutputs(milestoneSlug: MilestoneSlug): ScoredOutput[] {
  const db = getDb();

  const rows = db.prepare(`
    SELECT
      o.id,
      o.milestone_slug as milestoneSlug,
      o.type,
      o.title,
      o.description,
      o.status,
      o.department,
      o.published_date as publishedDate,
      o.last_updated as lastUpdated,
      o.rationale,
      o.rationale_updated_at as rationaleUpdatedAt,
      o.last_updated as lastUpdatedTs,
      COALESCE((SELECT COUNT(*) FROM media_articles ma WHERE ma.output_id = o.id), 0) as mediaCount,
      COALESCE((SELECT COUNT(*) FROM bill_stages bs WHERE bs.output_id = o.id AND bs.completed = 1), 0) as billStageCount,
      COALESCE((SELECT COUNT(*) FROM bill_stages bs WHERE bs.output_id = o.id AND bs.name = 'Royal Assent'), 0) as hasRoyalAssent,
      (
        -- Type weight
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
    LIMIT ?
  `).all(milestoneSlug, TOP_N) as ScoredOutput[];

  return rows;
}

/**
 * Generate AI rationale for top outputs that are missing one or have stale rationale.
 */
export async function generateRationales(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("Skipping rationale generation — ANTHROPIC_API_KEY not set");
    return;
  }

  const client = new Anthropic({ apiKey });
  const db = getDb();

  const updateStmt = db.prepare(
    "UPDATE outputs SET rationale = ?, rationale_updated_at = datetime('now') WHERE id = ?"
  );

  let generated = 0;
  let skipped = 0;

  for (const slug of MILESTONE_SLUGS) {
    const milestone = getMilestone(slug);
    const topOutputs = getTopOutputs(slug);

    for (const output of topOutputs) {
      // Skip if rationale is fresh (updated after last_updated)
      if (
        output.rationale &&
        output.rationaleUpdatedAt &&
        output.lastUpdatedTs &&
        output.rationaleUpdatedAt >= output.lastUpdatedTs
      ) {
        skipped++;
        continue;
      }

      try {
        const message = await client.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 150,
          messages: [
            {
              role: "user",
              content: `You are analysing UK government policy outputs for a dashboard tracking progress toward a specific milestone.

Milestone: "${milestone.title}"
Target: ${milestone.description}

Output to explain:
- Title: "${output.title}"
- Type: ${output.type}
- Status: ${output.status || "N/A"}
- Department: ${output.department || "N/A"}
- Published: ${output.publishedDate || "N/A"}

Write ONE sentence (max 25 words) explaining why this output matters for achieving the milestone target. Ground it in what the government or experts have publicly stated about this output's importance. Use language like "Core planning reform — …" or "Introduces mandatory targets for …" not "This bill aims to…"

Respond with ONLY the one-line rationale, no quotes or prefix.`,
            },
          ],
        });

        const rationale =
          message.content[0].type === "text"
            ? message.content[0].text.trim()
            : "";

        if (rationale) {
          updateStmt.run(rationale, output.id);
          console.log(`  ✓ ${output.title.slice(0, 60)}: ${rationale}`);
          generated++;
        }
      } catch (err) {
        console.error(`  ✗ Failed for "${output.title}":`, err);
      }
    }
  }

  console.log(
    `Rationale generation complete: ${generated} generated, ${skipped} cached`
  );
}

// Run standalone
if (require.main === module) {
  initDb();
  generateRationales()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    });
}

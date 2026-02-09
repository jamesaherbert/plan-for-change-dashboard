import crypto from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { getDb, initDb } from "../lib/db";
import { getMilestone, MILESTONE_SLUGS } from "../lib/milestones";
import { getTopOutputs } from "./generate-rationale";
import type { MilestoneSlug } from "../lib/types";

/**
 * Compute a hash of the current data state for a milestone.
 * Used to skip regeneration when nothing has changed.
 */
function computeDataHash(slug: MilestoneSlug): string {
  const db = getDb();

  const latestKpi = db
    .prepare(
      "SELECT value, date FROM kpi_snapshots WHERE milestone_slug = ? ORDER BY date DESC LIMIT 1"
    )
    .get(slug) as { value: number; date: string } | undefined;

  const outputStats = db
    .prepare(
      `SELECT COUNT(*) as cnt, MAX(last_updated) as latestUpdate
       FROM outputs WHERE milestone_slug = ? AND dismissed = 0`
    )
    .get(slug) as { cnt: number; latestUpdate: string | null };

  const hashInput = JSON.stringify({
    kpiValue: latestKpi?.value ?? null,
    kpiDate: latestKpi?.date ?? null,
    outputCount: outputStats.cnt,
    latestOutputUpdate: outputStats.latestUpdate,
  });

  return crypto.createHash("sha256").update(hashInput).digest("hex").slice(0, 16);
}

/**
 * Check if an existing briefing is still fresh.
 */
function getExistingHash(slug: MilestoneSlug): string | undefined {
  const db = getDb();
  const row = db
    .prepare("SELECT data_hash FROM milestone_briefings WHERE milestone_slug = ?")
    .get(slug) as { data_hash: string } | undefined;
  return row?.data_hash;
}

/**
 * Generate AI briefings for all milestones.
 */
export async function generateBriefings(): Promise<void> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.log("Skipping briefing generation — ANTHROPIC_API_KEY not set");
    return;
  }

  const client = new Anthropic({ apiKey });
  const db = getDb();

  const upsertStmt = db.prepare(`
    INSERT INTO milestone_briefings (milestone_slug, content, data_hash, generated_at)
    VALUES (?, ?, ?, datetime('now'))
    ON CONFLICT(milestone_slug) DO UPDATE SET
      content = excluded.content,
      data_hash = excluded.data_hash,
      generated_at = excluded.generated_at
  `);

  let generated = 0;
  let skipped = 0;

  for (const slug of MILESTONE_SLUGS) {
    const dataHash = computeDataHash(slug);
    const existingHash = getExistingHash(slug);

    if (existingHash === dataHash) {
      console.log(`  ⊘ ${slug}: briefing up-to-date`);
      skipped++;
      continue;
    }

    const milestone = getMilestone(slug);

    // Gather KPI context
    const kpiRows = db
      .prepare(
        "SELECT value, date, label FROM kpi_snapshots WHERE milestone_slug = ? ORDER BY date DESC LIMIT 3"
      )
      .all(slug) as { value: number; date: string; label: string | null }[];

    const kpiContext =
      kpiRows.length > 0
        ? kpiRows.map((r) => `- ${r.label || r.date}: ${r.value}`).join("\n")
        : "No KPI data available yet.";

    // Gather top 5 outputs context
    const topOutputs = getTopOutputs(slug).slice(0, 5);
    const outputsContext =
      topOutputs.length > 0
        ? topOutputs
            .map((o) => `- [${o.type}] "${o.title}" — Status: ${o.status || "N/A"}`)
            .join("\n")
        : "No key outputs tracked yet.";

    // Gather recent media context
    const mediaRows = db
      .prepare(
        "SELECT title, source, published_date FROM media_articles WHERE milestone_slug = ? ORDER BY published_date DESC LIMIT 5"
      )
      .all(slug) as {
      title: string;
      source: string;
      published_date: string | null;
    }[];

    const mediaContext =
      mediaRows.length > 0
        ? mediaRows
            .map(
              (m) =>
                `- "${m.title}" (${m.source}, ${m.published_date || "undated"})`
            )
            .join("\n")
        : "No recent media coverage.";

    try {
      const message = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: `You are writing a policy briefing for a UK government progress dashboard tracking a specific milestone from Labour's "Plan for Change".

Milestone: "${milestone.title}"
Target: ${milestone.description}
Target date: ${milestone.targetDate}
KPI metric: ${milestone.kpiLabel}

Current KPI data (most recent first):
${kpiContext}

Top government outputs (bills, policy papers, etc.):
${outputsContext}

Recent media headlines:
${mediaContext}

Write a briefing of exactly 4 paragraphs covering:
1. Current Status — Where are we now based on the KPI data? Include the latest value and how it compares to the target.
2. What's Needed — What rate of progress or change is needed to hit the target by the deadline?
3. Key Reforms — What is the government doing? Reference the most significant outputs, bills, or policy papers listed above.
4. Challenges — What are the known obstacles and risks to achieving this milestone?

Write in a factual, analytical tone. Use plain text with no markdown formatting or section headings. Separate paragraphs with blank lines. Keep the total length under 300 words.

Respond with ONLY the briefing text, no preamble or commentary.`,
          },
        ],
      });

      const briefingText =
        message.content[0].type === "text"
          ? message.content[0].text.trim()
          : "";

      if (briefingText) {
        upsertStmt.run(slug, briefingText, dataHash);
        console.log(`  ✓ ${slug}: briefing generated (${briefingText.length} chars)`);
        generated++;
      }
    } catch (err) {
      console.error(`  ✗ Failed for ${slug}:`, err);
    }
  }

  console.log(
    `Briefing generation complete: ${generated} generated, ${skipped} cached`
  );
}

// Run standalone
if (require.main === module) {
  initDb();
  generateBriefings()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("Fatal:", err);
      process.exit(1);
    });
}

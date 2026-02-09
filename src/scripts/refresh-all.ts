import { initDb } from "../lib/db";
import { MILESTONE_SLUGS } from "../lib/milestones";
import { fetchGovukOutputs } from "../lib/fetchers/govuk-search";
import { fetchBills } from "../lib/fetchers/parliament-bills";
import { fetchGuardianForMilestone, fetchGuardianForOutput } from "../lib/fetchers/guardian";
import { getDb } from "../lib/db";
import { fetchNhsRtt } from "../lib/fetchers/nhs";
import { fetchOnsGrowth } from "../lib/fetchers/ons";
import { fetchHousingSupply } from "../lib/fetchers/housing";
import { fetchPoliceWorkforce } from "../lib/fetchers/police";
import { fetchEducationEyfs } from "../lib/fetchers/education";
import { fetchEnergyTrends } from "../lib/fetchers/energy";
import { fetchDebates, fetchWrittenQuestions } from "../lib/fetchers/theyworkforyou";
import { fetchCommitteeInquiries } from "../lib/fetchers/committees";

async function main() {
  console.log("=== Plan for Change Dashboard — Data Refresh ===\n");

  // Ensure DB tables exist
  initDb();

  // 1. Fetch KPI data for all milestones
  console.log("\n--- KPI Data ---");

  try {
    await fetchOnsGrowth();
  } catch (err) {
    console.error("ONS economic growth fetch failed:", err);
  }

  try {
    await fetchHousingSupply();
  } catch (err) {
    console.error("Housing supply fetch failed:", err);
  }

  try {
    await fetchNhsRtt();
  } catch (err) {
    console.error("NHS RTT fetch failed:", err);
  }

  try {
    await fetchPoliceWorkforce();
  } catch (err) {
    console.error("Police workforce fetch failed:", err);
  }

  try {
    await fetchEducationEyfs();
  } catch (err) {
    console.error("Education EYFS fetch failed:", err);
  }

  try {
    await fetchEnergyTrends();
  } catch (err) {
    console.error("Energy trends fetch failed:", err);
  }

  // 2. Fetch Whitehall outputs for each milestone
  console.log("\n--- Whitehall Outputs (GOV.UK Search) ---");
  for (const slug of MILESTONE_SLUGS) {
    try {
      await fetchGovukOutputs(slug);
    } catch (err) {
      console.error(`GOV.UK outputs fetch failed for ${slug}:`, err);
    }
  }

  // 3. Fetch bills for each milestone
  console.log("\n--- Parliamentary Bills ---");
  for (const slug of MILESTONE_SLUGS) {
    try {
      await fetchBills(slug);
    } catch (err) {
      console.error(`Bills fetch failed for ${slug}:`, err);
    }
  }

  // 4. Fetch committee inquiries for each milestone
  console.log("\n--- Parliamentary Committees ---");
  for (const slug of MILESTONE_SLUGS) {
    try {
      await fetchCommitteeInquiries(slug);
    } catch (err) {
      console.error(`Committee inquiries fetch failed for ${slug}:`, err);
    }
  }

  // 5. Fetch debates and written questions (TheyWorkForYou)
  console.log("\n--- Parliamentary Debates & Written Questions ---");
  for (const slug of MILESTONE_SLUGS) {
    try {
      await fetchDebates(slug);
    } catch (err) {
      console.error(`Debates fetch failed for ${slug}:`, err);
    }
    try {
      await fetchWrittenQuestions(slug);
    } catch (err) {
      console.error(`Written questions fetch failed for ${slug}:`, err);
    }
  }

  // 6. Fetch Guardian articles for each milestone
  console.log("\n--- Guardian Media Coverage ---");
  for (const slug of MILESTONE_SLUGS) {
    try {
      await fetchGuardianForMilestone(slug);
    } catch (err) {
      console.error(`Guardian fetch failed for ${slug}:`, err);
    }
  }

  // 7. Fetch Guardian articles for specific high-value outputs (bills, policy papers)
  console.log("\n--- Guardian Coverage for Specific Outputs ---");
  if (process.env.GUARDIAN_API_KEY) {
    const db = getDb();
    const outputs = db
      .prepare(
        `SELECT id, milestone_slug, title FROM outputs
         WHERE type IN ('bill', 'policy_paper', 'white_paper')
           AND dismissed = 0 AND confidence = 'high'
           AND published_date >= '2024-07-01'
         ORDER BY last_updated DESC LIMIT 50`
      )
      .all() as { id: string; milestone_slug: string; title: string }[];

    console.log(`Found ${outputs.length} high-confidence outputs to search`);
    for (const output of outputs) {
      try {
        await fetchGuardianForOutput(
          output.milestone_slug as import("../lib/types").MilestoneSlug,
          output.id,
          output.title
        );
      } catch (err) {
        console.error(
          `Guardian output search failed for "${output.id}":`,
          err
        );
      }
    }
  } else {
    console.log("Skipping — GUARDIAN_API_KEY not set");
  }

  console.log("\n=== Refresh complete ===");
}

main().catch((err) => {
  console.error("Fatal error during refresh:", err);
  process.exit(1);
});

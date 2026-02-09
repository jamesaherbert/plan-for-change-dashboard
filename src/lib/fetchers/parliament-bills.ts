import { getDb } from "../db";
import { getMilestoneMapping } from "../milestones";
import type { MilestoneSlug } from "../types";

// ---------------------------------------------------------------------------
// UK Parliament Bills API fetcher
// Docs: https://bills-api.parliament.uk/index.html
// ---------------------------------------------------------------------------

const BILLS_SEARCH_URL = "https://bills-api.parliament.uk/api/v1/Bills";

interface ParliamentBillSummary {
  billId: number;
  shortTitle: string;
  currentHouse: string; // "Commons" | "Lords" | "Unassigned"
  originatingHouse: string;
  lastUpdate: string;
  billTypeId: number;
  isAct: boolean;
  currentStage?: {
    description: string;
    house: string;
    stageId: number;
    sessionId: number;
  };
}

interface ParliamentSearchResponse {
  items: Array<{
    billId: number;
    shortTitle: string;
    currentHouse: string;
    originatingHouse: string;
    lastUpdate: string;
    billTypeId: number;
    isAct: boolean;
    currentStage?: {
      description: string;
      house: string;
      stageId: number;
      sessionId: number;
    };
  }>;
  totalResults: number;
}

interface ParliamentStageSitting {
  stageId: number;
  date: string;
}

interface ParliamentStage {
  stageSittings: ParliamentStageSitting[];
  house: string; // "Commons" | "Lords"
  description: string;
  abbreviation: string;
  sessionId: number;
  sortOrder: number;
}

interface ParliamentStagesResponse {
  items: ParliamentStage[];
}

/**
 * Search the Parliament Bills API for matching bills.
 */
async function searchBills(
  searchTerm: string
): Promise<ParliamentBillSummary[]> {
  const params = new URLSearchParams({
    SearchTerm: searchTerm,
    CurrentHouse: "All",
    SortOrder: "DateUpdatedDescending",
  });

  const url = `${BILLS_SEARCH_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `Parliament Bills API error: ${res.status} ${res.statusText} for ${url}`
    );
    return [];
  }

  const data = (await res.json()) as ParliamentSearchResponse;
  return data.items ?? [];
}

/**
 * Fetch stages for a specific bill.
 */
async function fetchBillStages(
  billId: number
): Promise<ParliamentStage[]> {
  const url = `${BILLS_SEARCH_URL}/${billId}/Stages`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `Parliament Stages API error: ${res.status} ${res.statusText} for ${url}`
    );
    return [];
  }

  const data = (await res.json()) as ParliamentStagesResponse;
  return data.items ?? [];
}

/**
 * Check whether a bill title matches any of the exclude terms (case-insensitive).
 */
function shouldExclude(title: string, excludeTerms: string[]): boolean {
  const lowerTitle = title.toLowerCase();
  return excludeTerms.some((term) => lowerTitle.includes(term.toLowerCase()));
}

/**
 * Fetch bills from the UK Parliament Bills API for a given milestone
 * and store them in the outputs + bill_stages tables.
 */
export async function fetchBills(
  milestoneSlug: MilestoneSlug
): Promise<void> {
  const mapping = getMilestoneMapping(milestoneSlug);
  if (!mapping) {
    console.error(`No milestone mapping found for slug: ${milestoneSlug}`);
    return;
  }

  if (mapping.billSearchTerms.length === 0) {
    console.log(
      `[parliament-bills] No bill search terms for "${milestoneSlug}", skipping.`
    );
    return;
  }

  // Collect unique bills across all search terms
  const seenBillIds = new Set<number>();
  const bills: ParliamentBillSummary[] = [];

  for (const term of mapping.billSearchTerms) {
    try {
      const items = await searchBills(term);
      for (const bill of items) {
        if (seenBillIds.has(bill.billId)) continue;
        if (shouldExclude(bill.shortTitle, mapping.billExcludeTerms)) continue;
        seenBillIds.add(bill.billId);
        bills.push(bill);
      }
    } catch (err) {
      console.error(`Parliament bills fetch error (term="${term}"):`, err);
    }
  }

  const db = getDb();

  const upsertOutput = db.prepare(`
    INSERT OR REPLACE INTO outputs
      (id, milestone_slug, type, title, description, url, source, status,
       published_date, last_updated, department, confidence, dismissed)
    VALUES
      (?, ?, 'bill', ?, '', ?, 'parliament', ?, ?, ?, '', 'high', 0)
  `);

  const deleteStages = db.prepare(
    `DELETE FROM bill_stages WHERE output_id = ?`
  );

  const insertStage = db.prepare(`
    INSERT INTO bill_stages (output_id, name, house, date, completed)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Fetch all stages first (async), then write to DB (sync transaction)
  const billsWithStages: Array<{
    bill: ParliamentBillSummary;
    stages: ParliamentStage[];
  }> = [];

  for (const bill of bills) {
    try {
      const stages = await fetchBillStages(bill.billId);
      billsWithStages.push({ bill, stages });
    } catch (err) {
      console.error(
        `Failed to fetch stages for bill ${bill.billId}:`,
        err
      );
      billsWithStages.push({ bill, stages: [] });
    }
  }

  // Write everything inside a synchronous transaction
  const writeAll = db.transaction(
    (
      items: Array<{
        bill: ParliamentBillSummary;
        stages: ParliamentStage[];
      }>
    ) => {
      for (const { bill, stages } of items) {
        const outputId = `bill-${bill.billId}`;
        const billUrl = `https://bills.parliament.uk/bills/${bill.billId}`;
        const status = bill.isAct
          ? "Royal Assent"
          : bill.currentStage?.description ?? "";
        const lastUpdated = bill.lastUpdate
          ? bill.lastUpdate.slice(0, 10)
          : "";

        upsertOutput.run(
          outputId,
          milestoneSlug,
          bill.shortTitle,
          billUrl,
          status,
          lastUpdated, // published_date
          lastUpdated  // last_updated
        );

        // Replace stages for this bill
        deleteStages.run(outputId);

        for (const stage of stages) {
          const house = stage.house === "Commons" ? "Commons" : "Lords";
          // Use the earliest sitting date for this stage
          const stageDate =
            stage.stageSittings.length > 0
              ? stage.stageSittings
                  .map((s) => s.date)
                  .sort()[0]
                  .slice(0, 10)
              : null;
          // A stage is completed if it has at least one sitting
          const completed = stage.stageSittings.length > 0 ? 1 : 0;

          insertStage.run(
            outputId,
            stage.description,
            house,
            stageDate,
            completed
          );
        }
      }
    }
  );

  writeAll(billsWithStages);

  console.log(
    `[parliament-bills] Upserted ${billsWithStages.length} bills for "${milestoneSlug}"`
  );
}

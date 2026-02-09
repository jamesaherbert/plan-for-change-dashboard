import { getDb } from "../db";

// ---------------------------------------------------------------------------
// DfE Early Years Foundation Stage Profile (EYFSP) KPI fetcher
//
// Fetches the percentage of children achieving a "Good Level of Development"
// (GLD) from the DfE Explore Education Statistics API.
//
// The EYFSP is published annually in autumn for the previous school year.
// Target: 75% GLD.
//
// Known historical values:
//   2018-19: 71.8%
//   2019-20: No data (COVID - assessments cancelled)
//   2020-21: No data (COVID - assessments cancelled)
//   2021-22: 65.2%
//   2022-23: 67.2%
//   2023-24: 68.3% (provisional)
// ---------------------------------------------------------------------------

const DFE_STATS_URL =
  "https://explore-education-statistics.service.gov.uk/find-statistics/early-years-foundation-stage-profile-results";

const GOVUK_SEARCH_URL = "https://www.gov.uk/api/search.json";

// ---------------------------------------------------------------------------
// Types for the GOV.UK Search API
// ---------------------------------------------------------------------------

interface GovukSearchResult {
  title: string;
  description: string;
  link: string;
  public_timestamp: string;
}

interface GovukSearchResponse {
  results: GovukSearchResult[];
  total: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a school year label like "2023-24" or "2023/24" into an ISO date
 * representing September of the results year (the autumn of publication).
 * E.g. "2023-24" results are published in autumn 2024, so date = "2024-09-01".
 */
function schoolYearToDate(yearLabel: string): string | null {
  // Match patterns like "2023/24", "2023-24", "2023/2024", "2023-2024"
  const match = /(\d{4})[/-](\d{2,4})/.exec(yearLabel);
  if (!match) return null;

  const startYear = parseInt(match[1], 10);
  const endPart = match[2];
  const endYear =
    endPart.length === 2 ? startYear - (startYear % 100) + parseInt(endPart, 10) : parseInt(endPart, 10);

  // Results are published in September of the end year
  return `${endYear}-09-01`;
}

/**
 * Normalise a school year label to the short form "YYYY-YY".
 * E.g. "2023/24" -> "2023-24", "Academic year 2023/24" -> "2023-24".
 */
function normaliseYearLabel(raw: string): string | null {
  const match = /(\d{4})[/-](\d{2,4})/.exec(raw);
  if (!match) return null;
  const startYear = match[1];
  const endPart = match[2].length === 2 ? match[2] : match[2].slice(2);
  return `${startYear}-${endPart}`;
}

/**
 * Try to extract the GLD percentage from a headline statistic value string.
 * Handles formats like "67.2%", "67.2", "67.2 per cent".
 */
function parseGldPercentage(value: string): number | null {
  const cleaned = value.replace(/[,%]/g, "").replace(/per\s*cent/i, "").trim();
  const num = parseFloat(cleaned);
  if (isNaN(num) || num < 0 || num > 100) return null;
  return Math.round(num * 10) / 10;
}

// ---------------------------------------------------------------------------
// Approach 1: Scrape DfE Explore Education Statistics HTML page
// ---------------------------------------------------------------------------

/**
 * Scrape the EYFSP results page on the DfE Explore Education Statistics site.
 * The page contains the headline GLD percentage and the academic year in the title.
 */
async function fetchViaDfePage(): Promise<
  Array<{ value: number; date: string; label: string }>
> {
  try {
    console.log(`[education] Fetching DfE stats page: ${DFE_STATS_URL}`);

    const res = await fetch(DFE_STATS_URL, {
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) {
      console.error(`[education] DfE page returned HTTP ${res.status}`);
      return [];
    }

    const html = await res.text();

    // Extract the academic year from the page title/meta
    // Pattern: "Academic year 2024/25" or "Academic Year 2023/24"
    const yearMatch = /academic\s+year\s+(\d{4}[/-]\d{2,4})/i.exec(html);
    if (!yearMatch) {
      console.error("[education] Could not find academic year on DfE page");
      return [];
    }

    const yearLabel = normaliseYearLabel(yearMatch[1]);
    if (!yearLabel) {
      console.error(`[education] Could not parse year label: ${yearMatch[1]}`);
      return [];
    }

    // Find the GLD percentage in the headline section
    // Pattern: "68.3% had a good level of development" or "68.3% achieved a good level"
    const gldMatch = /(\d{1,2}\.\d)%\s*(?:had|achieved|attained|reaching)\s*a?\s*good\s*level\s*of\s*development/i.exec(html);
    if (!gldMatch) {
      // Try broader pattern: just look for percentage near "good level of development"
      const broader = /(\d{1,2}\.\d)%[^<]{0,100}good\s*level\s*of\s*development/i.exec(html);
      if (!broader) {
        console.error("[education] Could not find GLD percentage on DfE page");
        return [];
      }
      const value = parseGldPercentage(broader[1]);
      if (value === null) return [];

      const date = schoolYearToDate(yearLabel);
      if (!date) return [];

      console.log(`[education] Found GLD via DfE page (broad match): ${value}% (${yearLabel})`);
      return [{ value, date, label: yearLabel }];
    }

    const value = parseGldPercentage(gldMatch[1]);
    if (value === null) return [];

    const date = schoolYearToDate(yearLabel);
    if (!date) return [];

    console.log(`[education] Found GLD via DfE page: ${value}% (${yearLabel})`);
    return [{ value, date, label: yearLabel }];
  } catch (err) {
    console.error("[education] Error fetching DfE stats page:", err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Approach 2: GOV.UK Search API (fallback)
// ---------------------------------------------------------------------------

/**
 * Search GOV.UK for EYFSP publications and try to extract a GLD percentage
 * from the description/metadata.
 */
async function fetchViaGovukSearch(): Promise<
  Array<{ value: number; date: string; label: string }>
> {
  const searchQueries = [
    "early years foundation stage profile results",
    "EYFSP good level of development",
  ];

  for (const query of searchQueries) {
    try {
      const params = new URLSearchParams({
        q: query,
        filter_organisations: "department-for-education",
        count: "5",
        fields: "title,description,link,public_timestamp",
      });

      const url = `${GOVUK_SEARCH_URL}?${params.toString()}`;
      console.log(`[education] Searching GOV.UK for: "${query}"`);

      const res = await fetch(url, {
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        console.error(`[education] GOV.UK search returned HTTP ${res.status}`);
        continue;
      }

      const data: GovukSearchResponse = await res.json();
      const results = data.results ?? [];

      // Look for results that mention EYFSP and contain a percentage
      for (const result of results) {
        const text = `${result.title} ${result.description}`;
        const lower = text.toLowerCase();

        if (
          lower.includes("early years") ||
          lower.includes("eyfsp") ||
          lower.includes("foundation stage")
        ) {
          // Try to extract a year and percentage from the description
          const yearMatch = /(\d{4})[/-](\d{2,4})/.exec(text);
          const percentMatch = /(\d{1,2}\.\d)%/.exec(text);

          if (yearMatch && percentMatch) {
            const value = parseFloat(percentMatch[1]);
            const yearLabel = normaliseYearLabel(yearMatch[0]);

            if (yearLabel && !isNaN(value) && value >= 50 && value <= 85) {
              const date = schoolYearToDate(yearLabel);
              if (date) {
                console.log(
                  `[education] Found GLD via GOV.UK search: ${value}% (${yearLabel})`
                );
                return [{ value, date, label: yearLabel }];
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`[education] Error searching GOV.UK for "${query}":`, err);
    }
  }

  return [];
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Fetch EYFSP Good Level of Development (GLD) data and store as KPI snapshots.
 *
 * Strategy:
 *   1. Try the DfE Explore Education Statistics API (preferred, structured data)
 *   2. Fall back to GOV.UK Search API (less structured)
 *
 * Stores results in kpi_snapshots with milestone_slug = 'education'.
 */
export async function fetchEducationEyfs(): Promise<void> {
  console.log("[education] Starting EYFSP GLD data fetch...");

  // Approach 1: Scrape DfE Explore Education Statistics page
  let dataPoints = await fetchViaDfePage();

  // Approach 2: GOV.UK Search API (fallback)
  if (dataPoints.length === 0) {
    console.log("[education] DfE page did not return data, trying GOV.UK search...");
    dataPoints = await fetchViaGovukSearch();
  }

  if (dataPoints.length === 0) {
    console.error(
      "[education] No EYFSP GLD data could be fetched from any source. " +
        "This data is published annually in autumn. " +
        "Check https://explore-education-statistics.service.gov.uk/ for updates."
    );
    return;
  }

  // Sort by date ascending
  dataPoints.sort((a, b) => a.date.localeCompare(b.date));

  // Store in database
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO kpi_snapshots
      (milestone_slug, value, date, label)
    VALUES ('education', ?, ?, ?)
  `);

  const insertAll = db.transaction(
    (items: Array<{ value: number; date: string; label: string }>) => {
      for (const item of items) {
        upsert.run(item.value, item.date, item.label);
      }
    }
  );

  insertAll(dataPoints);

  const latest = dataPoints[dataPoints.length - 1];
  console.log(
    `[education] Stored ${dataPoints.length} KPI snapshot(s). ` +
      `Latest: ${latest.value}% GLD (${latest.label})`
  );
}

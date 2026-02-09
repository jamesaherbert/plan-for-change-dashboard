import { getDb } from "../db";

// ---------------------------------------------------------------------------
// ONS (Office for National Statistics) economic growth KPI fetcher
//
// Fetches UK economic data from the ONS website Time Series endpoint:
//   - Primary: RHDI per head index (series CRXS, dataset UKEA)
//   - Fallback: RHDI per head alternative (series CRXX, dataset UKEA)
//   - Secondary: GDP quarterly growth (series IHYQ, dataset PN2)
//   - Secondary fallback: GDP (series ABMI, dataset PN2)
//
// The old api.ons.gov.uk domain no longer serves time series data (returns 404).
// The www.ons.gov.uk website endpoint returns the same JSON structure and remains
// active. URL format:
//   https://www.ons.gov.uk/{topicPath}/timeseries/{series}/{dataset}/data
//
// Data is stored as quarterly KPI snapshots for the "economic-growth" milestone.
// ---------------------------------------------------------------------------

const ONS_BASE_URL = "https://www.ons.gov.uk";

interface OnsQuarter {
  date: string;
  value: string;
  year: string;
  quarter: string;
}

interface OnsTimeSeriesResponse {
  quarters?: OnsQuarter[];
}

interface SeriesConfig {
  seriesId: string;
  datasetId: string;
  /** Topic path on www.ons.gov.uk, e.g. "economy/grossdomesticproductgdp" */
  topicPath: string;
  label: string;
}

const PRIMARY_SERIES: SeriesConfig[] = [
  {
    seriesId: "CRXS",
    datasetId: "UKEA",
    topicPath: "economy/grossdomesticproductgdp",
    label: "RHDI per head index",
  },
  {
    seriesId: "CRXX",
    datasetId: "UKEA",
    topicPath: "economy/grossdomesticproductgdp",
    label: "RHDI per head (alt)",
  },
];

const SECONDARY_SERIES: SeriesConfig[] = [
  {
    seriesId: "IHYQ",
    datasetId: "PN2",
    topicPath: "economy/grossdomesticproductgdp",
    label: "GDP quarterly growth",
  },
  {
    seriesId: "ABMI",
    datasetId: "PN2",
    topicPath: "economy/grossdomesticproductgdp",
    label: "GDP at market prices",
  },
];

/**
 * Convert a quarter string like "Q3" to the ISO date of the first day
 * of that quarter: Q1 = Jan 1, Q2 = Apr 1, Q3 = Jul 1, Q4 = Oct 1.
 */
function quarterToIsoDate(year: string, quarter: string): string {
  const monthMap: Record<string, string> = {
    Q1: "01",
    Q2: "04",
    Q3: "07",
    Q4: "10",
  };
  const month = monthMap[quarter.toUpperCase()];
  if (!month) {
    throw new Error(`Invalid quarter: ${quarter}`);
  }
  return `${year}-${month}-01`;
}

/**
 * Format a label like "Q3 2024" from the year and quarter.
 */
function formatLabel(year: string, quarter: string): string {
  return `${quarter.toUpperCase()} ${year}`;
}

/**
 * Attempt to fetch quarterly data from a given ONS time series endpoint.
 * Returns parsed quarter data or null if the request fails.
 */
async function fetchSeries(
  config: SeriesConfig
): Promise<OnsQuarter[] | null> {
  const url = `${ONS_BASE_URL}/${config.topicPath}/timeseries/${config.seriesId.toLowerCase()}/${config.datasetId.toLowerCase()}/data`;
  console.log(`[ons] Trying series ${config.seriesId} (${config.label}): ${url}`);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(
        `[ons] Series ${config.seriesId} returned HTTP ${res.status}`
      );
      return null;
    }

    const data: OnsTimeSeriesResponse = await res.json();

    if (!data.quarters || !Array.isArray(data.quarters)) {
      console.error(
        `[ons] Series ${config.seriesId} response has no quarters array`
      );
      return null;
    }

    console.log(
      `[ons] Series ${config.seriesId} returned ${data.quarters.length} quarters`
    );
    return data.quarters;
  } catch (err) {
    console.error(`[ons] Failed to fetch series ${config.seriesId}:`, err);
    return null;
  }
}

/**
 * Try each series config in order, returning the first successful result.
 */
async function fetchWithFallback(
  seriesList: SeriesConfig[]
): Promise<{ quarters: OnsQuarter[]; config: SeriesConfig } | null> {
  for (const config of seriesList) {
    const quarters = await fetchSeries(config);
    if (quarters && quarters.length > 0) {
      return { quarters, config };
    }
  }
  return null;
}

/**
 * Fetch UK economic growth data from the ONS Time Series API and store
 * quarterly values as KPI snapshots for the "economic-growth" milestone.
 *
 * Tries RHDI per head series first, then falls back to GDP series.
 * Only data from 2020 onwards is stored.
 */
export async function fetchOnsGrowth(): Promise<void> {
  // Try primary series (RHDI per head), then secondary (GDP)
  const result =
    (await fetchWithFallback(PRIMARY_SERIES)) ??
    (await fetchWithFallback(SECONDARY_SERIES));

  if (!result) {
    console.error(
      "[ons] All series failed. Could not fetch economic growth data."
    );
    return;
  }

  const { quarters, config } = result;
  console.log(
    `[ons] Using series ${config.seriesId} (${config.label}) with ${quarters.length} data points`
  );

  // Parse and filter to 2020 onwards
  const CUTOFF_YEAR = 2020;

  const dataPoints: Array<{ value: number; date: string; label: string }> = [];

  for (const q of quarters) {
    const year = parseInt(q.year, 10);
    if (isNaN(year) || year < CUTOFF_YEAR) continue;

    const value = parseFloat(q.value);
    if (isNaN(value)) continue;

    const quarter = q.quarter || extractQuarter(q.date);
    if (!quarter) continue;

    try {
      const date = quarterToIsoDate(q.year, quarter);
      const label = formatLabel(q.year, quarter);
      dataPoints.push({ value, date, label });
    } catch {
      console.error(`[ons] Skipping invalid quarter entry: ${q.date}`);
    }
  }

  if (dataPoints.length === 0) {
    console.error("[ons] No valid data points after filtering");
    return;
  }

  // Sort by date ascending
  dataPoints.sort((a, b) => a.date.localeCompare(b.date));

  // Store in database using a transaction
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO kpi_snapshots
      (milestone_slug, value, date, label)
    VALUES ('economic-growth', ?, ?, ?)
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
    `[ons] Stored ${dataPoints.length} KPI snapshots (${config.label}). ` +
      `Latest: ${latest.value} (${latest.label})`
  );
}

/**
 * Extract a quarter identifier (e.g. "Q3") from a date string like "2024 Q3".
 * Returns null if no quarter can be parsed.
 */
function extractQuarter(dateStr: string): string | null {
  const match = /Q([1-4])/i.exec(dateStr);
  return match ? `Q${match[1]}` : null;
}

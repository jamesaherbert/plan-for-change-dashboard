import { getDb } from "../db";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// NHS RTT (Referral to Treatment) waiting times XLSX fetcher
//
// Strategy: Fetch the "RTT Overview Timeseries" XLSX from the NHS England
// statistics page. This small file (~115KB) contains a "Full Time Series"
// sheet with monthly national data from April 2007 onwards, including
// "% within 18 weeks" as a column.
// ---------------------------------------------------------------------------

const RTT_INDEX_URLS = [
  "https://www.england.nhs.uk/statistics/statistical-work-areas/rtt-waiting-times/rtt-data-2025-26/",
  "https://www.england.nhs.uk/statistics/statistical-work-areas/rtt-waiting-times/rtt-data-2024-25/",
];

async function discoverXlsxLinks(indexUrl: string): Promise<string[]> {
  const res = await fetch(indexUrl);
  if (!res.ok) return [];
  const html = await res.text();
  const linkRegex = /href=["']([^"']*\.xlsx?)["']/gi;
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    links.push(match[1]);
  }
  return links;
}

/**
 * Find the "RTT Overview Timeseries" file — the small summary file
 * containing national-level time series data.
 */
function findOverviewLink(links: string[]): string | null {
  for (const link of links) {
    const lower = link.toLowerCase();
    if (lower.includes("overview") && lower.includes("timeseries")) {
      return link;
    }
  }
  return null;
}

async function downloadAndParseXlsx(
  url: string
): Promise<XLSX.WorkBook | null> {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[nhs] Failed to download XLSX: ${res.status} from ${url}`);
    return null;
  }
  const arrayBuffer = await res.arrayBuffer();
  try {
    return XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  } catch (err) {
    console.error(`[nhs] Failed to parse XLSX from ${url}:`, err);
    return null;
  }
}

const MONTH_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * Excel serial date number → ISO date string.
 */
function excelDateToISO(serial: number): string {
  const epoch = new Date(1899, 11, 30); // Excel epoch
  const d = new Date(epoch.getTime() + serial * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Extract all "% within 18 weeks" values from the Overview Timeseries workbook.
 * The file has a "Full Time Series" sheet where:
 *   Row 11 (0-indexed) contains headers including "% within 18 weeks" at col 7
 *   Rows 12+ contain monthly data with Excel serial date numbers in col 2 (Month)
 */
function extractTimeSeries(
  workbook: XLSX.WorkBook
): Array<{ value: number; date: string; label: string }> {
  const sheet =
    workbook.Sheets["Full Time Series"] ||
    workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) return [];

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  });

  // Find the header row containing "% within 18 weeks"
  let percentColIdx = -1;
  let monthColIdx = -1;
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? "").toLowerCase();
      if (cell.includes("% within 18 weeks")) {
        percentColIdx = j;
        headerRowIdx = i;
      }
      if (cell === "month") {
        monthColIdx = j;
      }
    }
    if (percentColIdx >= 0) break;
  }

  if (percentColIdx < 0) {
    console.error("[nhs] Could not find '% within 18 weeks' column");
    return [];
  }
  if (monthColIdx < 0) {
    // Month column might be col 2 based on our inspection
    monthColIdx = 2;
  }

  const results: Array<{ value: number; date: string; label: string }> = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawPercent = row[percentColIdx];
    if (rawPercent == null || rawPercent === "-" || rawPercent === "") continue;

    let percentage = typeof rawPercent === "number" ? rawPercent : NaN;
    if (typeof rawPercent === "string") {
      percentage = parseFloat(rawPercent.replace(/%/, ""));
    }
    if (isNaN(percentage)) continue;

    // Convert decimal to percentage if needed
    if (percentage > 0 && percentage < 1) {
      percentage = percentage * 100;
    }
    percentage = Math.round(percentage * 10) / 10;

    // Parse the date from the Month column (Excel serial date)
    const rawDate = row[monthColIdx];
    let isoDate: string;
    let label: string;

    if (typeof rawDate === "number" && rawDate > 10000) {
      isoDate = excelDateToISO(rawDate);
      const d = new Date(isoDate);
      const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      label = `${monthNames[d.getMonth()]} ${d.getFullYear()}`;
    } else {
      // Skip rows where date cannot be parsed (e.g. footnoted entries like "* Feb-24")
      continue;
    }

    results.push({ value: percentage, date: isoDate, label });
  }

  return results;
}

/**
 * Fetch the NHS RTT Overview Timeseries and store all data points as KPI snapshots.
 */
export async function fetchNhsRtt(): Promise<void> {
  let xlsxUrl: string | null = null;

  for (const indexUrl of RTT_INDEX_URLS) {
    try {
      const links = await discoverXlsxLinks(indexUrl);
      const found = findOverviewLink(links);
      if (found) {
        xlsxUrl = found.startsWith("http")
          ? found
          : found.startsWith("/")
            ? `https://www.england.nhs.uk${found}`
            : `${indexUrl.replace(/\/[^/]*$/, "/")}${found}`;
        break;
      }
    } catch (err) {
      console.error(`[nhs] Error discovering links from ${indexUrl}:`, err);
    }
  }

  if (!xlsxUrl) {
    console.error("[nhs] Could not find Overview Timeseries XLSX");
    return;
  }

  console.log(`[nhs] Downloading Overview Timeseries from: ${xlsxUrl}`);

  const workbook = await downloadAndParseXlsx(xlsxUrl);
  if (!workbook) return;

  const timeSeries = extractTimeSeries(workbook);
  if (timeSeries.length === 0) {
    console.error("[nhs] No data points extracted from workbook");
    return;
  }

  // Store all data points (only keep recent years to avoid bloat)
  const cutoff = "2020-01-01";
  const recent = timeSeries.filter((d) => d.date >= cutoff);

  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO kpi_snapshots
      (milestone_slug, value, date, label)
    VALUES ('nhs', ?, ?, ?)
  `);

  const insertAll = db.transaction(
    (items: Array<{ value: number; date: string; label: string }>) => {
      for (const item of items) {
        upsert.run(item.value, item.date, item.label);
      }
    }
  );

  insertAll(recent);

  const latest = recent[recent.length - 1];
  console.log(
    `[nhs] Stored ${recent.length} KPI snapshots. Latest: ${latest.value}% (${latest.label})`
  );
}

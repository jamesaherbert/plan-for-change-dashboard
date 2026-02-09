import { getDb } from "../db";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Housing supply (net additional dwellings) XLSX fetcher
//
// Strategy: Fetch the GOV.UK Content API page for "Live tables on housing
// supply: net additional dwellings", extract the XLSX attachment URL for
// Table 120 (annual net additional dwellings in England), download and parse
// the spreadsheet, then store each financial year's figure as a KPI snapshot.
//
// Fallback: If the Content API or XLSX download fails, use the GOV.UK Search
// API to locate the publication URL.
// ---------------------------------------------------------------------------

const CONTENT_API_URL =
  "https://www.gov.uk/api/content/government/statistical-data-sets/live-tables-on-net-supply-of-housing";

/** HTML page URL for the same dataset (used for scraping fallback). */
const HTML_PAGE_URL =
  "https://www.gov.uk/government/statistical-data-sets/live-tables-on-net-supply-of-housing";

const SEARCH_API_URL =
  "https://www.gov.uk/api/search.json";

/** Minimum financial year to store (inclusive). "2015" means 2014-15 onwards. */
const MIN_YEAR = 2015;

// -- GOV.UK Content API types ------------------------------------------------

interface GovukAttachment {
  url: string;
  title: string;
  content_type?: string;
  filename?: string;
}

interface GovukContentResponse {
  title: string;
  details?: {
    attachments?: GovukAttachment[];
  };
}

// -- GOV.UK Search API types -------------------------------------------------

interface GovukSearchResult {
  title: string;
  link: string;
}

interface GovukSearchResponse {
  results: GovukSearchResult[];
  total: number;
}

// ---------------------------------------------------------------------------
// Discover the XLSX URL for Table 120
// ---------------------------------------------------------------------------

/**
 * Try the GOV.UK Content API first to find the Table 120 XLSX attachment.
 */
async function discoverFromContentApi(): Promise<string | null> {
  try {
    const res = await fetch(CONTENT_API_URL);
    if (!res.ok) {
      console.warn(
        `[housing] Content API returned ${res.status} for ${CONTENT_API_URL}`
      );
      return null;
    }

    const data = (await res.json()) as GovukContentResponse;
    const attachments = data.details?.attachments;
    if (!attachments || attachments.length === 0) {
      console.warn("[housing] No attachments found in Content API response");
      return null;
    }

    // Look for Table 120 (or LiveTable120) attachment.
    // Note: GOV.UK has migrated many attachments from XLSX to ODS format,
    // so we accept .xls, .xlsx, and .ods files.
    for (const att of attachments) {
      const combinedText = `${att.title ?? ""} ${att.filename ?? ""} ${att.url ?? ""}`.toLowerCase();
      const isTable120 =
        combinedText.includes("table 120") ||
        combinedText.includes("livetable120") ||
        combinedText.includes("table120") ||
        combinedText.includes("table_120") ||
        combinedText.includes("live_table_120");
      const isSpreadsheet =
        combinedText.includes(".xls") ||
        combinedText.includes(".xlsx") ||
        combinedText.includes(".ods");
      if (isTable120 && isSpreadsheet) {
        return att.url;
      }
    }

    // If no exact Table 120 match, look for any attachment mentioning
    // "net additional dwellings" in a spreadsheet format
    for (const att of attachments) {
      const combinedText = `${att.title ?? ""} ${att.filename ?? ""}`.toLowerCase();
      const isSpreadsheet =
        combinedText.includes(".xls") ||
        combinedText.includes(".xlsx") ||
        combinedText.includes(".ods");
      if (combinedText.includes("net additional") && isSpreadsheet) {
        return att.url;
      }
    }

    console.warn("[housing] No Table 120 XLSX found among attachments");
    return null;
  } catch (err) {
    console.error("[housing] Error fetching Content API:", err);
    return null;
  }
}

/**
 * Fallback: Use the GOV.UK Search API to find the publication page,
 * then scrape it for XLSX links.
 */
async function discoverFromSearchApi(): Promise<string | null> {
  try {
    const params = new URLSearchParams({
      q: "net additional dwellings live tables",
      filter_organisations: "ministry-of-housing-communities-local-government",
      count: "5",
    });

    const res = await fetch(`${SEARCH_API_URL}?${params.toString()}`);
    if (!res.ok) {
      console.warn(`[housing] Search API returned ${res.status}`);
      return null;
    }

    const data = (await res.json()) as GovukSearchResponse;
    const results = data.results ?? [];

    // Find the most relevant result
    const match = results.find((r) => {
      const lower = r.title.toLowerCase();
      return (
        lower.includes("net additional dwellings") ||
        lower.includes("live tables on housing supply") ||
        lower.includes("live tables on net supply")
      );
    });

    if (!match) {
      console.warn("[housing] No matching publication found via Search API");
      return null;
    }

    // Fetch the Content API for this specific page
    const contentUrl = `https://www.gov.uk/api/content${match.link}`;
    const contentRes = await fetch(contentUrl);
    if (!contentRes.ok) {
      console.warn(
        `[housing] Content API returned ${contentRes.status} for ${contentUrl}`
      );
      return null;
    }

    const contentData = (await contentRes.json()) as GovukContentResponse;
    const attachments = contentData.details?.attachments;
    if (!attachments || attachments.length === 0) return null;

    for (const att of attachments) {
      const combinedText = `${att.title ?? ""} ${att.filename ?? ""} ${att.url ?? ""}`.toLowerCase();
      const isTable120 =
        combinedText.includes("table 120") ||
        combinedText.includes("livetable120") ||
        combinedText.includes("table120") ||
        combinedText.includes("table_120") ||
        combinedText.includes("live_table_120");
      const isSpreadsheet =
        combinedText.includes(".xls") ||
        combinedText.includes(".xlsx") ||
        combinedText.includes(".ods");
      if (isTable120 && isSpreadsheet) {
        return att.url;
      }
    }

    return null;
  } catch (err) {
    console.error("[housing] Error with Search API fallback:", err);
    return null;
  }
}

/**
 * Third fallback: Scrape the HTML page directly for spreadsheet download links.
 * This mirrors the approach used by the NHS RTT fetcher.
 */
async function discoverFromHtmlPage(): Promise<string | null> {
  try {
    const res = await fetch(HTML_PAGE_URL);
    if (!res.ok) {
      console.warn(`[housing] HTML page returned ${res.status} for ${HTML_PAGE_URL}`);
      return null;
    }

    const html = await res.text();

    // Extract all spreadsheet links from the HTML page
    const linkRegex = /href=["']([^"']*(?:\.xlsx?|\.ods))["']/gi;
    const links: string[] = [];
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      links.push(match[1]);
    }

    if (links.length === 0) {
      console.warn("[housing] No spreadsheet links found on HTML page");
      return null;
    }

    // Look for Table 120 in the discovered links
    for (const link of links) {
      const lower = link.toLowerCase();
      if (
        lower.includes("table_120") ||
        lower.includes("table120") ||
        lower.includes("livetable120") ||
        lower.includes("live_table_120")
      ) {
        return link.startsWith("http") ? link : `https://www.gov.uk${link}`;
      }
    }

    // Broader match: any link with "120" in a spreadsheet filename
    for (const link of links) {
      const filename = link.split("/").pop()?.toLowerCase() ?? "";
      if (filename.includes("120")) {
        return link.startsWith("http") ? link : `https://www.gov.uk${link}`;
      }
    }

    console.warn("[housing] No Table 120 link found on HTML page");
    return null;
  } catch (err) {
    console.error("[housing] Error scraping HTML page:", err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Download and parse the XLSX / ODS
// ---------------------------------------------------------------------------

async function downloadAndParseXlsx(
  url: string
): Promise<XLSX.WorkBook | null> {
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `[housing] Failed to download XLSX: ${res.status} from ${url}`
    );
    return null;
  }
  const arrayBuffer = await res.arrayBuffer();
  try {
    return XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  } catch (err) {
    console.error(`[housing] Failed to parse XLSX from ${url}:`, err);
    return null;
  }
}

/**
 * Find the sheet containing annual net additional dwellings data.
 * Table 120 typically has a sheet named "Table 120" or similar.
 */
function findDataSheet(workbook: XLSX.WorkBook): XLSX.WorkSheet | null {
  // Try exact and partial matches for the sheet name
  const candidates = [
    "Table 120",
    "LiveTable120",
    "Live Table 120",
    "120",
  ];

  for (const name of candidates) {
    if (workbook.Sheets[name]) {
      return workbook.Sheets[name];
    }
  }

  // Try partial match on sheet names
  for (const sheetName of workbook.SheetNames) {
    if (sheetName.toLowerCase().includes("120")) {
      return workbook.Sheets[sheetName];
    }
  }

  // Last resort: try the first sheet
  if (workbook.SheetNames.length > 0) {
    console.warn(
      `[housing] No "Table 120" sheet found; falling back to first sheet: "${workbook.SheetNames[0]}"`
    );
    return workbook.Sheets[workbook.SheetNames[0]];
  }

  return null;
}

// ---------------------------------------------------------------------------
// Data extraction
// ---------------------------------------------------------------------------

interface HousingDataPoint {
  value: number;
  date: string;   // ISO date, e.g. "2023-03-31"
  label: string;  // Financial year, e.g. "2022-23"
}

/**
 * Parse a financial year string like "2022-23" or "2022/23" and return the
 * ending calendar year (e.g. 2023). Returns null if unrecognised.
 */
function parseFinancialYear(raw: string): number | null {
  // Match patterns like "2022-23", "2022/23", "2022-2023", "2022/2023"
  const match = raw.match(/(\d{4})\s*[-/]\s*(\d{2,4})/);
  if (!match) return null;

  const startYear = parseInt(match[1], 10);
  const endPart = match[2];

  if (endPart.length === 2) {
    // "2022-23" -> end year is 2023
    const century = Math.floor(startYear / 100) * 100;
    return century + parseInt(endPart, 10);
  }
  // "2022-2023" -> end year is 2023
  return parseInt(endPart, 10);
}

/**
 * Normalise a financial year into "YYYY-YY" label form (e.g. "2022-23").
 */
function normaliseLabel(endYear: number): string {
  const startYear = endYear - 1;
  const endShort = String(endYear).slice(2);
  return `${startYear}-${endShort}`;
}

/**
 * Extract annual net additional dwellings from the Table 120 sheet.
 *
 * The sheet structure varies between releases, but typically:
 *   - A header row contains "Year" or financial year references
 *   - A row labelled "England" or "ENGLAND" or "Net additional dwellings"
 *     contains the annual totals
 *   - OR the data is in a column-oriented layout with years in column A
 *     and values in column B or later
 */
function extractHousingData(sheet: XLSX.WorkSheet): HousingDataPoint[] {
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  });

  if (rows.length === 0) return [];

  const results: HousingDataPoint[] = [];

  // Strategy 1: Row-oriented layout where years are in a header row
  // and values are in a data row labelled "Total net additional dwellings",
  // "England", or similar. This is the layout used by Table 120.
  const rowOrientedResults = extractRowOriented(rows);
  if (rowOrientedResults.length > 0) return rowOrientedResults;

  // Strategy 2: Column-oriented layout where column A contains financial year
  // strings and a subsequent column contains numeric values.
  const yearColumnResults = extractColumnOriented(rows);
  if (yearColumnResults.length > 0) return yearColumnResults;

  return results;
}

/**
 * Strategy 1: Column-oriented layout.
 * Each row has a financial year in column 0 (or nearby) and a numeric value.
 */
function extractColumnOriented(rows: unknown[][]): HousingDataPoint[] {
  const results: HousingDataPoint[] = [];

  // First, find the header row to identify which column contains the totals.
  // Look for a column header that mentions "net additional", "total", or "England".
  let valueColIdx = -1;
  let yearColIdx = 0;
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row) continue;
    for (let j = 0; j < row.length; j++) {
      const cellStr = String(row[j] ?? "").toLowerCase().trim();
      if (
        cellStr.includes("net additional") ||
        cellStr.includes("total") ||
        cellStr === "england" ||
        cellStr.includes("net supply")
      ) {
        valueColIdx = j;
        headerRowIdx = i;
        break;
      }
    }
    if (valueColIdx >= 0) break;
  }

  // If we didn't find a labelled value column, try column 1 as default
  if (valueColIdx < 0) {
    valueColIdx = 1;
    headerRowIdx = -1;
  }

  // Now scan rows for financial year patterns in the year column
  const startRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 0;
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const yearCell = String(row[yearColIdx] ?? "").trim();
    const endYear = parseFinancialYear(yearCell);
    if (endYear === null) continue;
    if (endYear < MIN_YEAR) continue;

    // Find the numeric value - try the identified value column first,
    // then scan remaining columns for the first numeric value
    let value: number | null = null;

    const rawValue = row[valueColIdx];
    if (typeof rawValue === "number" && !isNaN(rawValue) && rawValue > 0) {
      value = rawValue;
    } else if (typeof rawValue === "string") {
      const parsed = parseFloat(rawValue.replace(/,/g, ""));
      if (!isNaN(parsed) && parsed > 0) {
        value = parsed;
      }
    }

    // If value column didn't yield a number, scan other columns
    if (value === null) {
      for (let j = 1; j < row.length; j++) {
        if (j === yearColIdx) continue;
        const cell = row[j];
        if (typeof cell === "number" && !isNaN(cell) && cell > 1000) {
          value = cell;
          break;
        } else if (typeof cell === "string") {
          const parsed = parseFloat(cell.replace(/,/g, ""));
          if (!isNaN(parsed) && parsed > 1000) {
            value = parsed;
            break;
          }
        }
      }
    }

    if (value === null) continue;

    // Round to nearest integer (housing completions are whole numbers)
    value = Math.round(value);

    const label = normaliseLabel(endYear);
    // Date = end of financial year (31 March)
    const date = `${endYear}-03-31`;

    results.push({ value, date, label });
  }

  return results;
}

/**
 * Strategy 2: Row-oriented layout.
 * A header row contains financial years, and a data row labelled "England"
 * or "Net additional dwellings" contains the values.
 */
function extractRowOriented(rows: unknown[][]): HousingDataPoint[] {
  const results: HousingDataPoint[] = [];

  // Find the header row with financial year strings
  let headerRowIdx = -1;
  const yearColumns: Array<{ colIdx: number; endYear: number }> = [];

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row) continue;

    const yearCols: Array<{ colIdx: number; endYear: number }> = [];
    for (let j = 0; j < row.length; j++) {
      const cellStr = String(row[j] ?? "").trim();
      const endYear = parseFinancialYear(cellStr);
      if (endYear !== null && endYear >= 2000 && endYear <= 2100) {
        yearCols.push({ colIdx: j, endYear });
      }
    }

    // If we found multiple year columns, this is likely the header row
    if (yearCols.length >= 3) {
      headerRowIdx = i;
      yearColumns.push(...yearCols);
      break;
    }
  }

  if (headerRowIdx < 0 || yearColumns.length === 0) return [];

  // Find the data row for England / net additional dwellings
  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const label = String(row[0] ?? "").toLowerCase().trim();
    // Match the grand total row, not sub-totals. Look for specific labels
    // that indicate the overall net additional dwellings figure.
    if (
      label.includes("total net additional") ||
      label.includes("net additional dwellings") ||
      (label.includes("net additional") && !label.includes("of which")) ||
      label === "england" ||
      label === "total"
    ) {
      // Extract values for each year column
      for (const { colIdx, endYear } of yearColumns) {
        if (endYear < MIN_YEAR) continue;

        const rawValue = row[colIdx];
        let value: number | null = null;

        if (typeof rawValue === "number" && !isNaN(rawValue) && rawValue > 0) {
          value = rawValue;
        } else if (typeof rawValue === "string") {
          const parsed = parseFloat(rawValue.replace(/,/g, ""));
          if (!isNaN(parsed) && parsed > 0) {
            value = parsed;
          }
        }

        if (value === null) continue;

        value = Math.round(value);
        const fyLabel = normaliseLabel(endYear);
        const date = `${endYear}-03-31`;

        results.push({ value, date, label: fyLabel });
      }

      break; // Only take the first matching data row
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Fetch UK housing supply (net additional dwellings) data from GOV.UK
 * and store as KPI snapshots in the database.
 */
export async function fetchHousingSupply(): Promise<void> {
  // Step 1: Discover the XLSX URL
  console.log("[housing] Discovering Table 120 XLSX URL...");

  let xlsxUrl = await discoverFromContentApi();

  if (!xlsxUrl) {
    console.log("[housing] Content API failed, trying Search API fallback...");
    xlsxUrl = await discoverFromSearchApi();
  }

  if (!xlsxUrl) {
    console.log("[housing] Search API failed, trying HTML page scraping...");
    xlsxUrl = await discoverFromHtmlPage();
  }

  if (!xlsxUrl) {
    console.error(
      "[housing] Could not discover Table 120 spreadsheet URL from any source"
    );
    return;
  }

  // Ensure absolute URL
  if (xlsxUrl.startsWith("/")) {
    xlsxUrl = `https://www.gov.uk${xlsxUrl}`;
  }

  console.log(`[housing] Downloading XLSX from: ${xlsxUrl}`);

  // Step 2: Download and parse the XLSX
  const workbook = await downloadAndParseXlsx(xlsxUrl);
  if (!workbook) return;

  console.log(
    `[housing] Workbook loaded. Sheets: ${workbook.SheetNames.join(", ")}`
  );

  // Step 3: Find the data sheet
  const sheet = findDataSheet(workbook);
  if (!sheet) {
    console.error("[housing] Could not find a suitable data sheet");
    return;
  }

  // Step 4: Extract housing data
  const dataPoints = extractHousingData(sheet);
  if (dataPoints.length === 0) {
    console.error("[housing] No data points extracted from XLSX");
    return;
  }

  // Sort by date ascending
  dataPoints.sort((a, b) => a.date.localeCompare(b.date));

  console.log(
    `[housing] Extracted ${dataPoints.length} data points (${dataPoints[0].label} to ${dataPoints[dataPoints.length - 1].label})`
  );

  // Step 5: Store in database
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO kpi_snapshots
      (milestone_slug, value, date, label)
    VALUES ('housing', ?, ?, ?)
  `);

  const insertAll = db.transaction((items: HousingDataPoint[]) => {
    for (const item of items) {
      upsert.run(item.value, item.date, item.label);
    }
  });

  insertAll(dataPoints);

  const latest = dataPoints[dataPoints.length - 1];
  console.log(
    `[housing] Stored ${dataPoints.length} KPI snapshots. Latest: ${latest.value.toLocaleString()} dwellings (${latest.label})`
  );
}

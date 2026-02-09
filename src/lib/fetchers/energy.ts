import { getDb } from "../db";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// DESNZ Energy Trends — Clean Energy KPI fetcher
//
// Fetches the percentage of UK electricity generated from clean sources
// (renewables + nuclear) using data published by the Department for Energy
// Security and Net Zero (DESNZ) in the quarterly Energy Trends release.
//
// Strategy:
//   1. Hit the GOV.UK Content API for the "Energy Trends section 6" page
//      which covers renewable electricity statistics.
//   2. Also try the GOV.UK Content API for "Energy Trends section 5" which
//      covers electricity generation by fuel type (needed for nuclear share).
//   3. From the JSON response, extract XLSX attachment URLs for tables like
//      ET 6.1 (renewable generation) and ET 5.1 (electricity by fuel).
//   4. Download the XLSX, parse the relevant sheet, and extract quarterly
//      clean electricity percentage data.
//   5. Store as KPI snapshots with milestone_slug = 'clean-energy'.
//
// The target is 95% clean power by 2030 (renewables + nuclear).
// ---------------------------------------------------------------------------

const GOVUK_CONTENT_API = "https://www.gov.uk/api/content";

/** Content API paths to try for energy statistics. */
const CONTENT_PATHS = [
  "/government/statistics/energy-trends-section-6-renewables",
  "/government/statistics/energy-trends-section-5-electricity",
];

/** Fallback: GOV.UK search API to discover Energy Trends publications. */
const GOVUK_SEARCH_URL = "https://www.gov.uk/api/search.json";

const CUTOFF_YEAR = 2020;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GovukAttachment {
  title?: string;
  url?: string;
  content_type?: string;
}

interface GovukContentResponse {
  title?: string;
  details?: {
    attachments?: GovukAttachment[];
    documents?: string[];
  };
}

interface GovukSearchResult {
  title: string;
  link: string;
}

interface GovukSearchResponse {
  results: GovukSearchResult[];
  total: number;
}

interface DataPoint {
  value: number;
  date: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Quarter utilities
// ---------------------------------------------------------------------------

const QUARTER_MONTH_MAP: Record<string, string> = {
  Q1: "01",
  Q2: "04",
  Q3: "07",
  Q4: "10",
};

function quarterToIsoDate(year: number, quarter: string): string {
  const q = quarter.toUpperCase();
  const month = QUARTER_MONTH_MAP[q];
  if (!month) {
    throw new Error(`Invalid quarter: ${quarter}`);
  }
  return `${year}-${month}-01`;
}

function formatLabel(year: number, quarter: string): string {
  return `${quarter.toUpperCase()} ${year}`;
}

// ---------------------------------------------------------------------------
// Excel serial date → ISO date
// ---------------------------------------------------------------------------

function excelDateToISO(serial: number): string {
  const epoch = new Date(1899, 11, 30); // Excel epoch
  const d = new Date(epoch.getTime() + serial * 86400000);
  return d.toISOString().slice(0, 10);
}

function isoDateToQuarterLabel(isoDate: string): string {
  const d = new Date(isoDate);
  const month = d.getMonth(); // 0-indexed
  const quarter = Math.floor(month / 3) + 1;
  return `Q${quarter} ${d.getFullYear()}`;
}

function isoDateToQuarterStart(isoDate: string): string {
  const d = new Date(isoDate);
  const month = d.getMonth();
  const quarterMonth = Math.floor(month / 3) * 3;
  const qd = new Date(d.getFullYear(), quarterMonth, 1);
  return qd.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// GOV.UK Content API helpers
// ---------------------------------------------------------------------------

/**
 * Fetch attachment metadata from a GOV.UK Content API page.
 */
async function fetchContentAttachments(
  contentPath: string
): Promise<GovukAttachment[]> {
  const url = `${GOVUK_CONTENT_API}${contentPath}`;
  console.log(`[energy] Fetching content API: ${url}`);

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
    });

    if (!res.ok) {
      console.error(`[energy] Content API returned ${res.status} for ${url}`);
      return [];
    }

    const data: GovukContentResponse = await res.json();

    if (data.details?.attachments && Array.isArray(data.details.attachments)) {
      console.log(
        `[energy] Found ${data.details.attachments.length} attachments on ${contentPath}`
      );
      return data.details.attachments;
    }

    // Some pages embed attachment links in an HTML "documents" field.
    // Try to extract XLSX URLs from there as a fallback.
    if (data.details?.documents && Array.isArray(data.details.documents)) {
      return extractAttachmentsFromDocumentsHtml(data.details.documents);
    }

    console.log(`[energy] No attachments found on ${contentPath}`);
    return [];
  } catch (err) {
    console.error(`[energy] Error fetching ${url}:`, err);
    return [];
  }
}

/**
 * Some GOV.UK Content API pages store attachment references inside an HTML
 * fragment in `details.documents[]`. This extracts XLSX links from those
 * HTML strings.
 */
function extractAttachmentsFromDocumentsHtml(
  documents: string[]
): GovukAttachment[] {
  const attachments: GovukAttachment[] = [];
  const linkRegex = /href=["']([^"']*\.xlsx?)["'][^>]*>([^<]*)/gi;

  for (const html of documents) {
    let match: RegExpExecArray | null;
    while ((match = linkRegex.exec(html)) !== null) {
      attachments.push({
        title: match[2].trim(),
        url: match[1],
      });
    }
  }

  return attachments;
}

/**
 * Fallback: search the GOV.UK Search API for Energy Trends publications
 * and then fetch their content pages for attachments.
 */
async function discoverAttachmentsViaSearch(): Promise<GovukAttachment[]> {
  const searchUrl = `${GOVUK_SEARCH_URL}?${new URLSearchParams({
    q: "energy trends renewables electricity",
    filter_organisations: "department-for-energy-security-and-net-zero",
    filter_content_store_document_type: "statistical_data_set",
    count: "5",
  }).toString()}`;

  console.log(`[energy] Searching GOV.UK: ${searchUrl}`);

  try {
    const res = await fetch(searchUrl);
    if (!res.ok) {
      console.error(`[energy] Search API returned ${res.status}`);
      return [];
    }

    const data: GovukSearchResponse = await res.json();

    if (!data.results || data.results.length === 0) {
      console.log("[energy] No search results found");
      return [];
    }

    // Try each result page for attachments
    for (const result of data.results) {
      const attachments = await fetchContentAttachments(result.link);
      if (attachments.length > 0) {
        return attachments;
      }
    }
  } catch (err) {
    console.error("[energy] Search API error:", err);
  }

  return [];
}

/**
 * Find the best XLSX attachment for renewable/clean electricity data.
 * Prioritises ET 6.1 (renewable electricity capacity and generation).
 */
function findBestXlsxUrl(attachments: GovukAttachment[]): string | null {
  const xlsxAttachments = attachments.filter(
    (a) =>
      a.url &&
      (a.url.toLowerCase().endsWith(".xlsx") ||
        a.url.toLowerCase().endsWith(".xls"))
  );

  if (xlsxAttachments.length === 0) return null;

  // Priority 1: ET 6.1 — Renewable electricity capacity and generation
  for (const a of xlsxAttachments) {
    const title = (a.title ?? "").toLowerCase();
    const url = (a.url ?? "").toLowerCase();
    if (
      title.includes("6.1") ||
      url.includes("6.1") ||
      url.includes("et_6.1") ||
      url.includes("et6.1")
    ) {
      return a.url!;
    }
  }

  // Priority 2: Any attachment mentioning "renewable" and "generation"
  for (const a of xlsxAttachments) {
    const title = (a.title ?? "").toLowerCase();
    if (title.includes("renewable") && title.includes("generation")) {
      return a.url!;
    }
  }

  // Priority 3: Any attachment mentioning "renewable"
  for (const a of xlsxAttachments) {
    const title = (a.title ?? "").toLowerCase();
    if (title.includes("renewable")) {
      return a.url!;
    }
  }

  // Priority 4: Any attachment with "6" in its name (section 6 tables)
  for (const a of xlsxAttachments) {
    const title = (a.title ?? "").toLowerCase();
    const url = (a.url ?? "").toLowerCase();
    if (title.includes("et 6") || url.includes("et_6") || url.includes("et6")) {
      return a.url!;
    }
  }

  // Fallback: return the first XLSX
  return xlsxAttachments[0].url ?? null;
}

// ---------------------------------------------------------------------------
// XLSX download and parsing
// ---------------------------------------------------------------------------

/**
 * Download an XLSX file and parse it into a workbook.
 */
async function downloadAndParseXlsx(
  url: string
): Promise<XLSX.WorkBook | null> {
  // Ensure absolute URL
  const absoluteUrl = url.startsWith("http")
    ? url
    : `https://assets.publishing.service.gov.uk${url}`;

  console.log(`[energy] Downloading XLSX: ${absoluteUrl}`);

  try {
    const res = await fetch(absoluteUrl);
    if (!res.ok) {
      console.error(
        `[energy] Failed to download XLSX: ${res.status} from ${absoluteUrl}`
      );
      return null;
    }

    const arrayBuffer = await res.arrayBuffer();
    return XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  } catch (err) {
    console.error(`[energy] Failed to parse XLSX from ${absoluteUrl}:`, err);
    return null;
  }
}

/**
 * Try to find a sheet with renewable electricity share/percentage data.
 * ET 6.1 typically has sheets like "Annual", "Quarterly", or "Quarter".
 *
 * Returns the sheet and a hint about what kind of data it contains.
 */
function findRelevantSheet(
  workbook: XLSX.WorkBook
): { sheet: XLSX.WorkSheet; name: string } | null {
  const sheetNames = workbook.SheetNames;
  console.log(`[energy] Available sheets: ${sheetNames.join(", ")}`);

  // Prefer quarterly data sheet
  const quarterlyPatterns = ["quarterly", "quarter", "qtr"];
  for (const name of sheetNames) {
    const lower = name.toLowerCase();
    if (quarterlyPatterns.some((p) => lower.includes(p))) {
      return { sheet: workbook.Sheets[name], name };
    }
  }

  // Try "Annual" if no quarterly sheet
  for (const name of sheetNames) {
    if (name.toLowerCase().includes("annual")) {
      return { sheet: workbook.Sheets[name], name };
    }
  }

  // Try any sheet that looks like it contains data (not contents/notes)
  for (const name of sheetNames) {
    const lower = name.toLowerCase();
    if (
      !lower.includes("content") &&
      !lower.includes("note") &&
      !lower.includes("cover") &&
      !lower.includes("info")
    ) {
      return { sheet: workbook.Sheets[name], name };
    }
  }

  // Fallback: first sheet
  if (sheetNames.length > 0) {
    return { sheet: workbook.Sheets[sheetNames[0]], name: sheetNames[0] };
  }

  return null;
}

/**
 * Extract renewable electricity share data from the workbook.
 *
 * The ET 6.1 workbook typically contains columns for:
 *   - Year / Quarter / Date
 *   - Total renewable generation (GWh or TWh)
 *   - Renewables share of electricity generation (%)
 *
 * We look for a column header that indicates a percentage share, then
 * extract the quarterly time series.
 */
function extractRenewablesData(workbook: XLSX.WorkBook): DataPoint[] {
  const sheetInfo = findRelevantSheet(workbook);
  if (!sheetInfo) {
    console.error("[energy] No relevant sheet found in workbook");
    return [];
  }

  console.log(`[energy] Using sheet: "${sheetInfo.name}"`);

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheetInfo.sheet, {
    header: 1,
    defval: null,
  });

  if (rows.length === 0) {
    console.error("[energy] Sheet is empty");
    return [];
  }

  // Strategy 1: Handle DESNZ transposed layout where dates are column
  // headers and metrics are row labels (ET 6.1 format).
  const transposed = extractFromTransposedSheet(rows);
  if (transposed.length > 0) return transposed;

  // Strategy 2: Find a "share" or "percentage" column (traditional layout)
  const result = extractFromShareColumn(rows);
  if (result.length > 0) return result;

  // Strategy 3: Find "total renewable generation" and "total generation"
  // columns and compute the share ourselves
  const computed = computeShareFromTotals(rows);
  if (computed.length > 0) return computed;

  // Strategy 4: Scan all sheets for transposed or share data
  for (const name of workbook.SheetNames) {
    if (name === sheetInfo.name) continue;
    const sheet = workbook.Sheets[name];
    const sheetRows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    });
    const altTransposed = extractFromTransposedSheet(sheetRows);
    if (altTransposed.length > 0) {
      console.log(`[energy] Found transposed data in alternative sheet: "${name}"`);
      return altTransposed;
    }
    const alt = extractFromShareColumn(sheetRows);
    if (alt.length > 0) {
      console.log(`[energy] Found data in alternative sheet: "${name}"`);
      return alt;
    }
  }

  console.error("[energy] Could not extract renewable share data");
  return [];
}

/**
 * Handle DESNZ transposed spreadsheet layout (ET 6.1 format).
 *
 * In this layout the spreadsheet has:
 *   - Column 0: row labels (metric names like "Onshore wind", "All renewables")
 *   - Columns 1..N: time periods, with header text like "2024 \r\n1st quarter"
 *   - Multiple vertically stacked tables separated by blank rows, each with
 *     its own section header row that also contains the period column headers.
 *
 * We look for a section header row containing "SHARES OF ELECTRICITY" or
 * similar, then find the "All renewables" data row below it, and read the
 * percentage values across all columns.
 */
function extractFromTransposedSheet(rows: unknown[][]): DataPoint[] {
  // Step 1: Find the "SHARES OF ELECTRICITY GENERATED" section header row
  let sharesHeaderRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const label = String(row[0] ?? "").toLowerCase();
    if (
      label.includes("share") &&
      (label.includes("electric") || label.includes("generat"))
    ) {
      sharesHeaderRowIdx = i;
      break;
    }
  }

  if (sharesHeaderRowIdx < 0) return [];

  console.log(`[energy] Found transposed shares header at row ${sharesHeaderRowIdx}`);

  const headerRow = rows[sharesHeaderRowIdx];
  if (!headerRow) return [];

  // Step 2: Parse the column headers (cols 1+) to get year/quarter dates
  const columnDates: ({ isoDate: string; label: string } | null)[] = [];
  for (let j = 0; j < headerRow.length; j++) {
    if (j === 0) {
      columnDates.push(null); // col 0 is the row label column
      continue;
    }
    const headerText = String(headerRow[j] ?? "");
    columnDates.push(parseTransposedColumnHeader(headerText));
  }

  // Step 3: Find the "All renewables" row below the header
  let renewablesRowIdx = -1;
  for (let i = sharesHeaderRowIdx + 1; i < Math.min(rows.length, sharesHeaderRowIdx + 20); i++) {
    const row = rows[i];
    if (!row) break; // blank row means end of this table section
    const label = String(row[0] ?? "").toLowerCase().trim();
    if (label.includes("all renewable") || label === "all renewables") {
      renewablesRowIdx = i;
      break;
    }
  }

  if (renewablesRowIdx < 0) {
    console.log("[energy] Could not find 'All renewables' row in transposed shares section");
    return [];
  }

  console.log(`[energy] Found 'All renewables' data at row ${renewablesRowIdx}`);

  const dataRow = rows[renewablesRowIdx];
  if (!dataRow) return [];

  // Step 4: Extract data points from each column
  const results: DataPoint[] = [];
  for (let j = 1; j < dataRow.length; j++) {
    const rawValue = dataRow[j];
    let value = parseNumericCell(rawValue);
    if (value === null) continue;

    // Values in the shares section are already percentages (e.g. 38.5 = 38.5%)
    // If they look like decimal fractions (0 < v < 1), convert to percentage
    if (value > 0 && value < 1) {
      value = Math.round(value * 1000) / 10;
    } else {
      value = Math.round(value * 10) / 10;
    }

    const dateInfo = j < columnDates.length ? columnDates[j] : null;
    if (!dateInfo) continue;

    const year = new Date(dateInfo.isoDate).getFullYear();
    if (year < CUTOFF_YEAR) continue;

    results.push({
      value,
      date: dateInfo.isoDate,
      label: dateInfo.label,
    });
  }

  console.log(`[energy] Extracted ${results.length} data points from transposed sheet`);
  return results;
}

/**
 * Parse a transposed column header like "2024 \r\n1st quarter" or "2024"
 * into an ISO date and label.
 *
 * Common formats:
 *   "2024 \r\n1st quarter"  ->  Q1 2024
 *   "2024 \r\n2nd quarter"  ->  Q2 2024
 *   "2024 \r\n3rd quarter"  ->  Q3 2024
 *   "2024 \r\n4th quarter"  ->  Q4 2024
 *   "2024"                  ->  2024 (annual)
 */
function parseTransposedColumnHeader(
  text: string
): { isoDate: string; label: string } | null {
  if (!text || text.trim() === "") return null;

  const cleaned = text.replace(/\r\n/g, " ").replace(/\n/g, " ").trim();

  // Match "YYYY Nth quarter" pattern
  const qtrMatch = /(\d{4})\s+(\d)(?:st|nd|rd|th)\s+quarter/i.exec(cleaned);
  if (qtrMatch) {
    const year = parseInt(qtrMatch[1], 10);
    const qNum = parseInt(qtrMatch[2], 10);
    if (qNum >= 1 && qNum <= 4 && year >= 1990 && year <= 2100) {
      const q = `Q${qNum}`;
      try {
        return {
          isoDate: quarterToIsoDate(year, q),
          label: formatLabel(year, q),
        };
      } catch {
        // fall through
      }
    }
  }

  // Match "Q1 2024" or "2024 Q1" pattern
  const qMatch = /(?:Q\s*([1-4]))\s+(\d{4})|(\d{4})\s+Q\s*([1-4])/i.exec(cleaned);
  if (qMatch) {
    const quarter = qMatch[1] ?? qMatch[4];
    const year = parseInt(qMatch[2] ?? qMatch[3], 10);
    const q = `Q${quarter}`;
    try {
      return {
        isoDate: quarterToIsoDate(year, q),
        label: formatLabel(year, q),
      };
    } catch {
      // fall through
    }
  }

  // Match just a year "2024"
  const yearOnly = /^(\d{4})$/.exec(cleaned);
  if (yearOnly) {
    const year = parseInt(yearOnly[1], 10);
    if (year >= 1990 && year <= 2100) {
      return {
        isoDate: `${year}-01-01`,
        label: `${year}`,
      };
    }
  }

  return null;
}

/**
 * Look for a column whose header contains keywords like "share",
 * "percentage", or "% of", and extract time-series data from it.
 */
function extractFromShareColumn(rows: unknown[][]): DataPoint[] {
  const shareKeywords = [
    "share",
    "percentage",
    "% of",
    "percent",
    "proportion",
    "renewables as a",
    "renewable share",
  ];

  let shareColIdx = -1;
  let dateColIdx = -1;
  let yearColIdx = -1;
  let quarterColIdx = -1;
  let headerRowIdx = -1;

  // Scan first 30 rows for headers (DESNZ spreadsheets often have
  // multiple header/title rows before the actual column headers)
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row) continue;

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? "").toLowerCase().trim();
      if (!cell) continue;

      // Look for the share/percentage column.
      // Skip column 0 — in DESNZ transposed spreadsheets, col 0 contains
      // row labels (e.g. "SHARES OF ELECTRICITY GENERATED (%)") which
      // would be a false match. The transposed layout is handled by
      // extractFromTransposedSheet instead.
      if (
        j > 0 &&
        shareColIdx < 0 &&
        shareKeywords.some((kw) => cell.includes(kw)) &&
        (cell.includes("generat") || cell.includes("electric") || cell.includes("renew"))
      ) {
        shareColIdx = j;
        headerRowIdx = i;
      }

      // Look for date/period columns in the same row or nearby
      if (cell === "year" || cell === "date" || cell === "period") {
        if (cell === "year") yearColIdx = j;
        else dateColIdx = j;
      }
      if (cell === "quarter" || cell === "qtr") {
        quarterColIdx = j;
      }
    }

    if (shareColIdx >= 0) break;
  }

  if (shareColIdx < 0) return [];

  console.log(
    `[energy] Found share column at index ${shareColIdx}, header row ${headerRowIdx}`
  );

  // Also try to find year/quarter columns in the header row
  if (headerRowIdx >= 0) {
    const headerRow = rows[headerRowIdx];
    if (headerRow) {
      for (let j = 0; j < headerRow.length; j++) {
        const cell = String(headerRow[j] ?? "").toLowerCase().trim();
        if (yearColIdx < 0 && (cell === "year" || cell.includes("year"))) {
          yearColIdx = j;
        }
        if (
          quarterColIdx < 0 &&
          (cell === "quarter" || cell === "qtr" || cell.includes("quarter"))
        ) {
          quarterColIdx = j;
        }
        if (
          dateColIdx < 0 &&
          (cell === "date" || cell === "period" || cell === "month")
        ) {
          dateColIdx = j;
        }
      }
    }
  }

  return parseDataRows(rows, headerRowIdx, shareColIdx, {
    dateColIdx,
    yearColIdx,
    quarterColIdx,
  });
}

/**
 * Look for "total renewable generation" and "total generation" columns
 * and compute the share = renewable / total * 100.
 */
function computeShareFromTotals(rows: unknown[][]): DataPoint[] {
  let renewableColIdx = -1;
  let totalColIdx = -1;
  let dateColIdx = -1;
  let yearColIdx = -1;
  let quarterColIdx = -1;
  let headerRowIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row) continue;

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? "").toLowerCase().trim();
      if (!cell) continue;

      if (
        renewableColIdx < 0 &&
        cell.includes("renewable") &&
        (cell.includes("total") || cell.includes("generation"))
      ) {
        renewableColIdx = j;
        headerRowIdx = i;
      }

      if (
        totalColIdx < 0 &&
        cell.includes("total") &&
        cell.includes("generation") &&
        !cell.includes("renewable")
      ) {
        totalColIdx = j;
      }

      if (cell === "year") yearColIdx = j;
      if (cell === "quarter" || cell === "qtr") quarterColIdx = j;
      if (cell === "date" || cell === "period") dateColIdx = j;
    }
  }

  if (renewableColIdx < 0 || totalColIdx < 0 || headerRowIdx < 0) {
    return [];
  }

  console.log(
    `[energy] Computing share from renewable col ${renewableColIdx} / total col ${totalColIdx}`
  );

  const results: DataPoint[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const renewableVal = parseNumericCell(row[renewableColIdx]);
    const totalVal = parseNumericCell(row[totalColIdx]);

    if (renewableVal === null || totalVal === null || totalVal === 0) continue;

    const share = Math.round((renewableVal / totalVal) * 1000) / 10;

    const dateInfo = extractDateFromRow(row, {
      dateColIdx,
      yearColIdx,
      quarterColIdx,
    });
    if (!dateInfo) continue;

    const year = new Date(dateInfo.isoDate).getFullYear();
    if (year < CUTOFF_YEAR) continue;

    results.push({
      value: share,
      date: dateInfo.isoDate,
      label: dateInfo.label,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// Row-level parsing helpers
// ---------------------------------------------------------------------------

interface DateColumnIndices {
  dateColIdx: number;
  yearColIdx: number;
  quarterColIdx: number;
}

/**
 * Parse data rows starting after the header, extracting the value from
 * `valueColIdx` and the date from whichever date columns are available.
 */
function parseDataRows(
  rows: unknown[][],
  headerRowIdx: number,
  valueColIdx: number,
  dateCols: DateColumnIndices
): DataPoint[] {
  const results: DataPoint[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const rawValue = row[valueColIdx];
    let value = parseNumericCell(rawValue);
    if (value === null) continue;

    // If the value looks like a decimal fraction (0-1), convert to percentage
    if (value > 0 && value < 1) {
      value = Math.round(value * 1000) / 10;
    } else {
      value = Math.round(value * 10) / 10;
    }

    const dateInfo = extractDateFromRow(row, dateCols);
    if (!dateInfo) continue;

    const year = new Date(dateInfo.isoDate).getFullYear();
    if (year < CUTOFF_YEAR) continue;

    results.push({
      value,
      date: dateInfo.isoDate,
      label: dateInfo.label,
    });
  }

  return results;
}

function parseNumericCell(cell: unknown): number | null {
  if (cell == null || cell === "" || cell === "-" || cell === "..") return null;

  if (typeof cell === "number") {
    return isNaN(cell) ? null : cell;
  }

  if (typeof cell === "string") {
    const cleaned = cell.replace(/[%,\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  return null;
}

/**
 * Extract date information from a row, trying multiple strategies:
 *   1. Explicit year + quarter columns
 *   2. An Excel serial date number
 *   3. A text date / period string (e.g. "Q1 2024", "2024 Q1", "Jan-Mar 2024")
 */
function extractDateFromRow(
  row: unknown[],
  dateCols: DateColumnIndices
): { isoDate: string; label: string } | null {
  const { dateColIdx, yearColIdx, quarterColIdx } = dateCols;

  // Strategy 1: year + quarter columns
  if (yearColIdx >= 0 && quarterColIdx >= 0) {
    const yearVal = row[yearColIdx];
    const qtrVal = row[quarterColIdx];

    const year = parseYear(yearVal);
    const quarter = parseQuarter(qtrVal);

    if (year !== null && quarter !== null) {
      try {
        return {
          isoDate: quarterToIsoDate(year, quarter),
          label: formatLabel(year, quarter),
        };
      } catch {
        // fall through
      }
    }
  }

  // Strategy 2: year column only (treat as annual data, use Q1)
  if (yearColIdx >= 0 && quarterColIdx < 0) {
    const yearVal = row[yearColIdx];
    const year = parseYear(yearVal);
    if (year !== null) {
      return {
        isoDate: `${year}-01-01`,
        label: `${year}`,
      };
    }
  }

  // Strategy 3: date column
  if (dateColIdx >= 0) {
    const rawDate = row[dateColIdx];
    return parseDateCell(rawDate);
  }

  // Strategy 4: try the first couple of columns for date-like values
  for (let j = 0; j < Math.min(row.length, 4); j++) {
    const cell = row[j];
    if (cell == null) continue;

    // Excel serial date
    if (typeof cell === "number" && cell > 30000 && cell < 60000) {
      const isoDate = excelDateToISO(cell);
      return {
        isoDate: isoDateToQuarterStart(isoDate),
        label: isoDateToQuarterLabel(isoDate),
      };
    }

    // Text that looks like a date/quarter reference
    if (typeof cell === "string") {
      const parsed = parseDateCell(cell);
      if (parsed) return parsed;
    }
  }

  return null;
}

function parseYear(val: unknown): number | null {
  if (typeof val === "number" && val >= 1990 && val <= 2100) {
    return Math.floor(val);
  }
  if (typeof val === "string") {
    const match = /\b(19|20)\d{2}\b/.exec(val);
    if (match) return parseInt(match[0], 10);
  }
  return null;
}

function parseQuarter(val: unknown): string | null {
  if (val == null) return null;
  const str = String(val).trim();
  const match = /Q\s*([1-4])/i.exec(str);
  if (match) return `Q${match[1]}`;

  // Numeric quarter
  const num = parseInt(str, 10);
  if (num >= 1 && num <= 4) return `Q${num}`;

  return null;
}

/**
 * Parse a date cell that might be an Excel serial date, an ISO date string,
 * or a descriptive period like "Q1 2024" or "Jan-Mar 2024".
 */
function parseDateCell(
  rawDate: unknown
): { isoDate: string; label: string } | null {
  if (rawDate == null) return null;

  // Excel serial date
  if (typeof rawDate === "number" && rawDate > 10000) {
    const isoDate = excelDateToISO(rawDate);
    return {
      isoDate: isoDateToQuarterStart(isoDate),
      label: isoDateToQuarterLabel(isoDate),
    };
  }

  if (typeof rawDate !== "string") return null;

  const str = rawDate.trim();
  if (!str) return null;

  // "Q1 2024" or "2024 Q1" pattern
  const qMatch = /(?:Q\s*([1-4]))\s+(\d{4})|(\d{4})\s+Q\s*([1-4])/i.exec(str);
  if (qMatch) {
    const quarter = qMatch[1] ?? qMatch[4];
    const year = parseInt(qMatch[2] ?? qMatch[3], 10);
    const q = `Q${quarter}`;
    try {
      return {
        isoDate: quarterToIsoDate(year, q),
        label: formatLabel(year, q),
      };
    } catch {
      // fall through
    }
  }

  // "2024" — just a year
  const yearOnly = /^((?:19|20)\d{2})$/.exec(str);
  if (yearOnly) {
    const year = parseInt(yearOnly[1], 10);
    return {
      isoDate: `${year}-01-01`,
      label: `${year}`,
    };
  }

  // ISO-like date "2024-01-01"
  const isoMatch = /^(\d{4}-\d{2}-\d{2})/.exec(str);
  if (isoMatch) {
    const isoDate = isoMatch[1];
    return {
      isoDate: isoDateToQuarterStart(isoDate),
      label: isoDateToQuarterLabel(isoDate),
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fallback: Scrape XLSX links from GOV.UK HTML page
// ---------------------------------------------------------------------------

async function discoverXlsxLinksFromHtml(): Promise<string | null> {
  const pageUrl =
    "https://www.gov.uk/government/statistics/energy-trends-section-6-renewables";
  console.log(`[energy] Fetching HTML page: ${pageUrl}`);

  try {
    const res = await fetch(pageUrl);
    if (!res.ok) {
      console.error(`[energy] HTML page returned ${res.status}`);
      return null;
    }

    const html = await res.text();
    const linkRegex = /href=["']([^"']*(?:ET_?6\.?1|et_?6\.?1)[^"']*\.xlsx?)["']/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
      return match[1];
    }

    // Broader search for any XLSX with "6" or "renewable"
    const broadRegex =
      /href=["']([^"']*(?:renewable|section.?6)[^"']*\.xlsx?)["']/gi;
    while ((match = broadRegex.exec(html)) !== null) {
      return match[1];
    }

    // Last resort: any XLSX on the page
    const anyXlsx = /href=["']([^"']*\.xlsx?)["']/gi;
    while ((match = anyXlsx.exec(html)) !== null) {
      return match[1];
    }
  } catch (err) {
    console.error(`[energy] Error fetching HTML page:`, err);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch UK clean energy KPI data from the DESNZ Energy Trends publication.
 *
 * Extracts the percentage of electricity generated from renewable sources
 * (the "renewables share" of generation) and stores quarterly snapshots
 * in the kpi_snapshots table with milestone_slug = 'clean-energy'.
 *
 * The function tries multiple approaches to locate and parse the data:
 *   1. GOV.UK Content API for section 6 (renewables)
 *   2. GOV.UK Content API for section 5 (electricity by fuel)
 *   3. GOV.UK Search API for Energy Trends publications
 *   4. Direct HTML scraping for XLSX links
 */
export async function fetchEnergyTrends(): Promise<void> {
  console.log("[energy] Starting Energy Trends fetch...");

  let xlsxUrl: string | null = null;
  let allAttachments: GovukAttachment[] = [];

  // Approach 1 & 2: Try Content API for known section pages
  for (const contentPath of CONTENT_PATHS) {
    try {
      const attachments = await fetchContentAttachments(contentPath);
      if (attachments.length > 0) {
        allAttachments = allAttachments.concat(attachments);
      }
    } catch (err) {
      console.error(
        `[energy] Error fetching content path ${contentPath}:`,
        err
      );
    }
  }

  if (allAttachments.length > 0) {
    xlsxUrl = findBestXlsxUrl(allAttachments);
  }

  // Approach 3: Search API fallback
  if (!xlsxUrl) {
    console.log("[energy] Trying GOV.UK Search API fallback...");
    try {
      const searchAttachments = await discoverAttachmentsViaSearch();
      if (searchAttachments.length > 0) {
        xlsxUrl = findBestXlsxUrl(searchAttachments);
      }
    } catch (err) {
      console.error("[energy] Search fallback error:", err);
    }
  }

  // Approach 4: Direct HTML scraping fallback
  if (!xlsxUrl) {
    console.log("[energy] Trying HTML scraping fallback...");
    xlsxUrl = await discoverXlsxLinksFromHtml();
  }

  if (!xlsxUrl) {
    console.error(
      "[energy] Could not find an XLSX download URL for Energy Trends data"
    );
    return;
  }

  console.log(`[energy] Found XLSX URL: ${xlsxUrl}`);

  // Download and parse the XLSX
  const workbook = await downloadAndParseXlsx(xlsxUrl);
  if (!workbook) return;

  const dataPoints = extractRenewablesData(workbook);

  if (dataPoints.length === 0) {
    console.error("[energy] No data points extracted from workbook");
    return;
  }

  // Sort by date ascending
  dataPoints.sort((a, b) => a.date.localeCompare(b.date));

  // Deduplicate by date (keep last occurrence, i.e. most recent revision)
  const seen = new Map<string, DataPoint>();
  for (const dp of dataPoints) {
    seen.set(dp.date, dp);
  }
  const deduplicated = Array.from(seen.values()).sort((a, b) =>
    a.date.localeCompare(b.date)
  );

  // Store in database using a transaction
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO kpi_snapshots
      (milestone_slug, value, date, label)
    VALUES ('clean-energy', ?, ?, ?)
  `);

  const insertAll = db.transaction((items: DataPoint[]) => {
    for (const item of items) {
      upsert.run(item.value, item.date, item.label);
    }
  });

  insertAll(deduplicated);

  const latest = deduplicated[deduplicated.length - 1];
  console.log(
    `[energy] Stored ${deduplicated.length} KPI snapshots for clean-energy. ` +
      `Latest: ${latest.value}% (${latest.label})`
  );
}

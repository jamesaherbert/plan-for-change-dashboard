import { getDb } from "../db";
import * as XLSX from "xlsx";

// ---------------------------------------------------------------------------
// Police workforce (England & Wales) fetcher
//
// Strategy: Use the GOV.UK Search API to find the latest Home Office
// "Police workforce, England and Wales" statistical publications, then
// discover XLSX attachments from the publication HTML pages, download them,
// and extract total headcount figures for police officers, PCSOs, and
// special constables.
//
// The policing milestone targets 13,000 *additional* neighbourhood police.
// We store raw totals here — the UI computes deltas against a baseline.
// ---------------------------------------------------------------------------

const GOVUK_SEARCH_URL = "https://www.gov.uk/api/search.json";
const GOVUK_CONTENT_API = "https://www.gov.uk/api/content";

const MONTH_NAMES: Record<string, string> = {
  january: "01",
  february: "02",
  march: "03",
  april: "04",
  may: "05",
  june: "06",
  july: "07",
  august: "08",
  september: "09",
  october: "10",
  november: "11",
  december: "12",
};

const MONTH_ABBREVS: Record<string, string> = {
  "01": "Jan",
  "02": "Feb",
  "03": "Mar",
  "04": "Apr",
  "05": "May",
  "06": "Jun",
  "07": "Jul",
  "08": "Aug",
  "09": "Sep",
  "10": "Oct",
  "11": "Nov",
  "12": "Dec",
};

// ---------------------------------------------------------------------------
// GOV.UK Search: find police workforce publications
// ---------------------------------------------------------------------------

interface GovukSearchResult {
  title: string;
  link: string;
  public_timestamp: string;
  format: string;
  content_store_document_type: string;
}

interface GovukSearchResponse {
  results: GovukSearchResult[];
  total: number;
}

/**
 * Find police workforce publications by trying known GOV.UK paths.
 *
 * The publications follow a consistent URL pattern:
 *   /government/statistics/police-workforce-england-and-wales-{DD}-{month}-{YYYY}
 *
 * Data is published biannually (31 March and 30 September snapshots).
 * We try recent dates in reverse chronological order.
 */
async function findPoliceWorkforcePublications(): Promise<GovukSearchResult[]> {
  const results: GovukSearchResult[] = [];

  // Generate candidate paths for the last few biannual publications
  const now = new Date();
  const currentYear = now.getFullYear();
  const candidates: string[] = [];

  // Try years from current back to 2020
  for (let year = currentYear; year >= 2020; year--) {
    candidates.push(
      `/government/statistics/police-workforce-england-and-wales-30-september-${year}`,
      `/government/statistics/police-workforce-england-and-wales-31-march-${year}`
    );
  }

  for (const path of candidates) {
    try {
      const contentUrl = `${GOVUK_CONTENT_API}${path}`;
      const res = await fetch(contentUrl, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) continue;

      const data = (await res.json()) as GovukContentResponse;
      results.push({
        title: data.title,
        link: path,
        public_timestamp: "",
        format: "",
        content_store_document_type: "official_statistics",
      });

      // We only need the latest publication for now
      if (results.length >= 2) break;
    } catch {
      // ignore timeout/fetch errors for individual paths
    }
  }

  // Fallback: GOV.UK Search API
  if (results.length === 0) {
    const params = new URLSearchParams({
      q: "\"police workforce\" \"england and wales\"",
      filter_organisations: "home-office",
      count: "5",
      fields: "title,link,public_timestamp,format,content_store_document_type",
      order: "-public_timestamp",
    });

    try {
      const res = await fetch(`${GOVUK_SEARCH_URL}?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as GovukSearchResponse;
        results.push(...(data.results ?? []));
      }
    } catch (err) {
      console.error("[police] GOV.UK search request failed:", err);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Content API: discover XLSX attachment URLs from a publication
// ---------------------------------------------------------------------------

interface GovukAttachment {
  url: string;
  title: string;
  content_type: string;
}

interface GovukContentDetail {
  documents?: string[];
  attachments?: GovukAttachment[];
}

interface GovukContentResponse {
  title: string;
  details: GovukContentDetail;
  links?: {
    children?: Array<{ base_path: string; title: string }>;
  };
}

/**
 * Fetch the GOV.UK Content API for a publication and extract spreadsheet
 * attachment URLs (XLSX, XLS, or ODS). Falls back to scraping the HTML page
 * if the Content API does not list attachments.
 */
async function discoverXlsxAttachments(linkPath: string): Promise<string[]> {
  const xlsxUrls: string[] = [];

  // Approach 1: Content API
  try {
    const contentUrl = `${GOVUK_CONTENT_API}${linkPath}`;
    const res = await fetch(contentUrl);
    if (res.ok) {
      const data = (await res.json()) as GovukContentResponse;

      // Direct attachments on the publication
      if (data.details?.attachments) {
        for (const att of data.details.attachments) {
          if (att.url && /\.(?:xlsx?|ods)$/i.test(att.url)) {
            xlsxUrls.push(
              att.url.startsWith("http")
                ? att.url
                : `https://www.gov.uk${att.url}`
            );
          }
        }
      }

      // Embedded HTML in the documents field may contain download links
      if (data.details?.documents) {
        for (const docHtml of data.details.documents) {
          const linkRegex = /href=["']([^"']*\.(?:xlsx?|ods))["']/gi;
          let match: RegExpExecArray | null;
          while ((match = linkRegex.exec(docHtml)) !== null) {
            const href = match[1];
            xlsxUrls.push(
              href.startsWith("http") ? href : `https://www.gov.uk${href}`
            );
          }
        }
      }

      // Some publications are "collections" with child pages
      if (xlsxUrls.length === 0 && data.links?.children) {
        for (const child of data.links.children) {
          const childXlsx = await discoverXlsxAttachments(child.base_path);
          xlsxUrls.push(...childXlsx);
        }
      }
    }
  } catch (err) {
    console.error(
      `[police] Content API fetch failed for ${linkPath}:`,
      err
    );
  }

  // Approach 2: Scrape the HTML page for XLSX links
  if (xlsxUrls.length === 0) {
    try {
      const htmlRes = await fetch(`https://www.gov.uk${linkPath}`);
      if (htmlRes.ok) {
        const html = await htmlRes.text();
        const linkRegex = /href=["']([^"']*\.(?:xlsx?|ods))["']/gi;
        let match: RegExpExecArray | null;
        while ((match = linkRegex.exec(html)) !== null) {
          const href = match[1];
          xlsxUrls.push(
            href.startsWith("http") ? href : `https://www.gov.uk${href}`
          );
        }
      }
    } catch (err) {
      console.error(
        `[police] HTML scrape failed for ${linkPath}:`,
        err
      );
    }
  }

  // Deduplicate
  return [...new Set(xlsxUrls)];
}

// ---------------------------------------------------------------------------
// XLSX download and parsing
// ---------------------------------------------------------------------------

async function downloadWorkbook(url: string): Promise<XLSX.WorkBook | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(
        `[police] Failed to download spreadsheet: ${res.status} from ${url}`
      );
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });
  } catch (err) {
    console.error(`[police] Error downloading/parsing spreadsheet from ${url}:`, err);
    return null;
  }
}

/**
 * Excel serial date number to ISO date string.
 */
function excelDateToISO(serial: number): string {
  const epoch = new Date(1899, 11, 30);
  const d = new Date(epoch.getTime() + serial * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * Attempt to find a sheet that contains workforce headcount data.
 * The Home Office ODS/XLSX files have multiple tables:
 *   - Table_1..3: Per-force breakdowns (FTE) for current period
 *   - Table_4: National time series (FTE) — the one we want
 *   - Table_5..7: Per-force breakdowns (headcount)
 *   - Table_8+: Demographics, diversity, etc.
 */
function findWorkforceSheet(workbook: XLSX.WorkBook): string | null {
  const sheetNames = workbook.SheetNames;

  // Priority 1: Table_4 is the national time series in the standard layout
  if (sheetNames.includes("Table_4")) return "Table_4";

  // Priority 2: Look for sheets with time-series-like patterns
  const patterns = [
    /table.*h1/i,
    /time.?series/i,
    /workforce/i,
    /headcount/i,
    /summary/i,
    /overview/i,
    /table.*4/i,
    /officer/i,
    /strength/i,
  ];

  for (const pattern of patterns) {
    const match = sheetNames.find((name) => pattern.test(name));
    if (match) return match;
  }

  // Fall back to first sheet that looks like a data sheet
  return sheetNames.find((n) => n.toLowerCase().startsWith("table")) ?? sheetNames[0] ?? null;
}

interface WorkforceDataPoint {
  date: string;
  label: string;
  totalOfficers: number;
  totalPCSOs: number;
  totalSpecials: number;
  combinedTotal: number;
}

/**
 * Try to extract workforce totals from a workbook.
 *
 * The typical structure is a table with columns including:
 *   - Date / Period (e.g. "31 March 2024")
 *   - Total police officers (FTE or headcount)
 *   - PCSOs
 *   - Special constables
 *
 * We search for header rows containing these keywords and then read data rows.
 */
function extractWorkforceData(workbook: XLSX.WorkBook): WorkforceDataPoint[] {
  const results: WorkforceDataPoint[] = [];

  // Try multiple sheets — some workbooks split data across sheets
  const sheetsToTry: string[] = [];
  const primarySheet = findWorkforceSheet(workbook);
  if (primarySheet) sheetsToTry.push(primarySheet);

  // Also try all sheets with relevant names
  for (const name of workbook.SheetNames) {
    if (!sheetsToTry.includes(name)) {
      const lower = name.toLowerCase();
      if (
        lower.includes("table") ||
        lower.includes("officer") ||
        lower.includes("workforce") ||
        lower.includes("headcount") ||
        lower.includes("summary")
      ) {
        sheetsToTry.push(name);
      }
    }
  }

  for (const sheetName of sheetsToTry) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    });

    const sheetResults = tryExtractFromRows(rows);
    if (sheetResults.length > 0) {
      results.push(...sheetResults);
      break; // Use the first sheet that yields results
    }
  }

  return results;
}

/**
 * Given raw rows from a sheet, try to locate column headers for
 * officer/PCSO/special counts and extract data points.
 */
function tryExtractFromRows(rows: unknown[][]): WorkforceDataPoint[] {
  // Scan for header row. We need a row that has multiple distinct column
  // headers (date + at least one metric), not just a title row that
  // happens to mention workforce terms.
  let headerRowIdx = -1;
  let dateColIdx = -1;
  let officerColIdx = -1;
  let pcsoColIdx = -1;
  let specialColIdx = -1;
  let totalColIdx = -1;

  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const row = rows[i];
    if (!row) continue;

    // Count how many non-null cells this row has — title rows typically
    // have content only in column 0, while header rows span multiple columns.
    const nonNullCount = row.filter((c) => c != null && String(c).trim() !== "").length;
    if (nonNullCount < 2) continue;

    let rowDateCol = -1;
    let rowOfficerCol = -1;
    let rowPcsoCol = -1;
    let rowSpecialCol = -1;
    let rowTotalCol = -1;
    let relevantHeaders = 0;

    for (let j = 0; j < row.length; j++) {
      const cell = String(row[j] ?? "").toLowerCase().trim();
      if (!cell) continue;

      // Date/period column
      if (
        cell === "as at" ||
        cell === "as of" ||
        cell === "date" ||
        cell === "period" ||
        cell === "year"
      ) {
        rowDateCol = j;
      }

      // Total police officers
      if (
        (cell.includes("officer") || cell.includes("police officer")) &&
        (cell.includes("total") || cell.includes("all"))
      ) {
        rowOfficerCol = j;
        relevantHeaders++;
      } else if (
        cell === "police officers" ||
        (cell.includes("officer") &&
          !cell.includes("pcso") &&
          !cell.includes("special") &&
          !cell.includes("community") &&
          cell.length < 40) // Avoid matching long title strings
      ) {
        if (rowOfficerCol < 0) {
          rowOfficerCol = j;
          relevantHeaders++;
        }
      }

      // PCSOs
      if (
        cell === "pcsos" ||
        cell === "pcsOs" ||
        (cell.includes("community support") && cell.length < 60)
      ) {
        rowPcsoCol = j;
        relevantHeaders++;
      }

      // Special constables
      if (cell.includes("special") && cell.length < 30) {
        rowSpecialCol = j;
        relevantHeaders++;
      }

      // A combined total column
      if (
        cell === "total" ||
        (cell.includes("total") &&
          !cell.includes("officer") &&
          !cell.includes("staff") &&
          cell.length < 20)
      ) {
        rowTotalCol = j;
      }
    }

    // Accept this row as header if it has a date column OR multiple
    // metric columns — not just a single keyword match in a title row
    if (relevantHeaders >= 1 && (rowDateCol >= 0 || relevantHeaders >= 2)) {
      headerRowIdx = i;
      dateColIdx = rowDateCol;
      officerColIdx = rowOfficerCol;
      pcsoColIdx = rowPcsoCol;
      specialColIdx = rowSpecialCol;
      totalColIdx = rowTotalCol;
      break;
    }
  }

  if (headerRowIdx < 0) return [];

  // If no date column found, try column 0
  if (dateColIdx < 0) dateColIdx = 0;

  const results: WorkforceDataPoint[] = [];

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    // Parse date
    const rawDate = row[dateColIdx];
    const parsed = parsePoliceDate(rawDate);
    if (!parsed) continue;

    const { isoDate, label } = parsed;

    // Parse numeric values
    const officers = parseNumericCell(
      officerColIdx >= 0 ? row[officerColIdx] : null
    );
    const pcsos = parseNumericCell(pcsoColIdx >= 0 ? row[pcsoColIdx] : null);
    const specials = parseNumericCell(
      specialColIdx >= 0 ? row[specialColIdx] : null
    );

    // If we got a total column but no individual columns, use that
    const total =
      totalColIdx >= 0 ? parseNumericCell(row[totalColIdx]) : null;

    const combinedTotal =
      officers !== null || pcsos !== null || specials !== null
        ? (officers ?? 0) + (pcsos ?? 0) + (specials ?? 0)
        : total;

    if (combinedTotal === null || combinedTotal === 0) continue;

    results.push({
      date: isoDate,
      label,
      totalOfficers: officers ?? 0,
      totalPCSOs: pcsos ?? 0,
      totalSpecials: specials ?? 0,
      combinedTotal,
    });
  }

  return results;
}

/**
 * Parse a date value from the police workforce spreadsheet.
 * Handles:
 *   - Excel serial dates (number > 10000)
 *   - Strings like "31 March 2024", "Mar 2024", "March 2024"
 *   - ISO date strings "2024-03-31"
 */
function parsePoliceDate(
  raw: unknown
): { isoDate: string; label: string } | null {
  if (raw == null) return null;

  // Excel serial date
  if (typeof raw === "number" && raw > 10000) {
    const isoDate = excelDateToISO(raw);
    const d = new Date(isoDate);
    const monthNum = String(d.getMonth() + 1).padStart(2, "0");
    const label = `${MONTH_ABBREVS[monthNum] ?? "???"} ${d.getFullYear()}`;
    return { isoDate, label };
  }

  const str = String(raw).trim();
  if (!str) return null;

  // ISO format: "2024-03-31"
  const isoMatch = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month] = isoMatch;
    const label = `${MONTH_ABBREVS[month] ?? "???"} ${year}`;
    return { isoDate: str, label };
  }

  // "31 March 2024" or "March 2024"
  const longMatch = str.match(
    /(?:(\d{1,2})\s+)?(\w+)\s+(\d{4})/
  );
  if (longMatch) {
    const [, day, monthStr, year] = longMatch;
    const monthLower = monthStr.toLowerCase();
    const monthNum = MONTH_NAMES[monthLower];
    if (monthNum) {
      const dayStr = day ? day.padStart(2, "0") : "01";
      const isoDate = `${year}-${monthNum}-${dayStr}`;
      const label = `${MONTH_ABBREVS[monthNum] ?? "???"} ${year}`;
      return { isoDate, label };
    }
  }

  // "Mar 2024" (abbreviated)
  const shortMatch = str.match(/^(\w{3})\s+(\d{4})$/);
  if (shortMatch) {
    const [, monthAbbr, year] = shortMatch;
    const monthLower = monthAbbr.toLowerCase();
    // Find month number from abbreviation
    for (const [num, abbr] of Object.entries(MONTH_ABBREVS)) {
      if (abbr.toLowerCase() === monthLower) {
        const isoDate = `${year}-${num}-01`;
        const label = `${abbr} ${year}`;
        return { isoDate, label };
      }
    }
  }

  return null;
}

/**
 * Parse a cell value as a number. Handles comma-separated thousands,
 * percentage signs, and whitespace.
 */
function parseNumericCell(raw: unknown): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") return raw;

  const str = String(raw).replace(/[,%\s]/g, "").trim();
  if (str === "" || str === "-" || str === "..") return null;

  const num = parseFloat(str);
  return isNaN(num) ? null : num;
}

// ---------------------------------------------------------------------------
// Date extraction from publication title
// ---------------------------------------------------------------------------

/**
 * Extract a date from a publication title like
 * "Police workforce, England and Wales: 31 March 2024"
 */
function extractDateFromTitle(
  title: string
): { isoDate: string; label: string } | null {
  // Match patterns like "31 March 2024"
  const match = title.match(
    /(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
  );
  if (match) {
    const [, day, monthStr, year] = match;
    const monthNum = MONTH_NAMES[monthStr.toLowerCase()];
    if (monthNum) {
      const isoDate = `${year}-${monthNum}-${day.padStart(2, "0")}`;
      const label = `${MONTH_ABBREVS[monthNum]} ${year}`;
      return { isoDate, label };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Fetch UK police workforce data from Home Office publications on GOV.UK,
 * and store total headcount (officers + PCSOs + specials) as KPI snapshots
 * for the "policing" milestone.
 */
export async function fetchPoliceWorkforce(): Promise<void> {
  console.log("[police] Searching GOV.UK for police workforce publications...");

  const publications = await findPoliceWorkforcePublications();
  if (publications.length === 0) {
    console.error("[police] No police workforce publications found");
    return;
  }

  console.log(
    `[police] Found ${publications.length} publications, processing...`
  );

  const allDataPoints: WorkforceDataPoint[] = [];
  const seenDates = new Set<string>();

  for (const pub of publications) {
    // Only process publications that look like police workforce stats
    const titleLower = pub.title.toLowerCase();
    if (
      !titleLower.includes("police") ||
      !titleLower.includes("workforce")
    ) {
      continue;
    }

    console.log(`[police] Processing: "${pub.title}" (${pub.link})`);

    // Try to get the date from the title for fallback
    const titleDate = extractDateFromTitle(pub.title);

    // Discover spreadsheet attachments (XLSX, XLS, ODS)
    const xlsxUrls = await discoverXlsxAttachments(pub.link);
    if (xlsxUrls.length === 0) {
      console.log(`[police] No spreadsheet files found for "${pub.title}"`);
      continue;
    }

    console.log(
      `[police] Found ${xlsxUrls.length} spreadsheet file(s) for "${pub.title}"`
    );

    // Try each XLSX until we find one with workforce data
    let foundData = false;

    // Sort URLs to prioritise main workforce tables (which have the national
    // time series in Table_4) over neighbourhood-specific tables.
    const sortedUrls = [...xlsxUrls].sort((a, b) => {
      const aLower = a.toLowerCase();
      const bLower = b.toLowerCase();
      // Main tables file (without "neighbourhood") should come first
      const aMain = aLower.includes("neighbourhood") ? 1 : 0;
      const bMain = bLower.includes("neighbourhood") ? 1 : 0;
      return aMain - bMain;
    });

    for (const xlsxUrl of sortedUrls) {
      // Prefer files with "workforce" or "headline" or "table" in the name
      const urlLower = xlsxUrl.toLowerCase();
      const isLikelyWorkforceFile =
        urlLower.includes("workforce") ||
        urlLower.includes("headline") ||
        urlLower.includes("table") ||
        urlLower.includes("officer") ||
        urlLower.includes("strength") ||
        urlLower.includes("neighbourhood");

      if (sortedUrls.length > 1 && !isLikelyWorkforceFile) {
        // Skip files that are clearly not workforce data (e.g. diversity, pay)
        if (
          urlLower.includes("diversity") ||
          urlLower.includes("ethnicity") ||
          urlLower.includes("pay") ||
          urlLower.includes("sickness") ||
          urlLower.includes("leaver")
        ) {
          continue;
        }
      }

      console.log(`[police] Downloading: ${xlsxUrl}`);
      const workbook = await downloadWorkbook(xlsxUrl);
      if (!workbook) continue;

      const dataPoints = extractWorkforceData(workbook);
      if (dataPoints.length > 0) {
        for (const dp of dataPoints) {
          if (!seenDates.has(dp.date)) {
            seenDates.add(dp.date);
            allDataPoints.push(dp);
          }
        }
        foundData = true;
        break; // Found data in this file, move to next publication
      }
    }

    // If we couldn't parse any XLSX but have a title date, try a simpler approach:
    // Look for any numeric totals in the first XLSX
    if (!foundData && titleDate) {
      console.log(
        `[police] Could not extract structured data, trying fallback for "${pub.title}"`
      );
      for (const xlsxUrl of xlsxUrls) {
        const workbook = await downloadWorkbook(xlsxUrl);
        if (!workbook) continue;

        const fallback = tryFallbackExtraction(workbook, titleDate);
        if (fallback && !seenDates.has(fallback.date)) {
          seenDates.add(fallback.date);
          allDataPoints.push(fallback);
          break;
        }
      }
    }
  }

  if (allDataPoints.length === 0) {
    console.error("[police] No workforce data points could be extracted");
    return;
  }

  // Filter to 2020 onwards
  const cutoff = "2020-01-01";
  const recent = allDataPoints
    .filter((dp) => dp.date >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (recent.length === 0) {
    console.error("[police] No data points from 2020 onwards");
    return;
  }

  // Store in database
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO kpi_snapshots
      (milestone_slug, value, date, label)
    VALUES ('policing', ?, ?, ?)
  `);

  const insertAll = db.transaction((items: WorkforceDataPoint[]) => {
    for (const item of items) {
      upsert.run(Math.round(item.combinedTotal), item.date, item.label);
    }
  });

  insertAll(recent);

  const latest = recent[recent.length - 1];
  console.log(
    `[police] Stored ${recent.length} KPI snapshots. Latest: ${latest.combinedTotal.toLocaleString()} total (officers: ${latest.totalOfficers.toLocaleString()}, PCSOs: ${latest.totalPCSOs.toLocaleString()}, specials: ${latest.totalSpecials.toLocaleString()}) as of ${latest.label}`
  );
}

// ---------------------------------------------------------------------------
// Fallback extraction: scan all sheets for any large number that could
// represent a total workforce figure, using the publication title date.
// ---------------------------------------------------------------------------

function tryFallbackExtraction(
  workbook: XLSX.WorkBook,
  titleDate: { isoDate: string; label: string }
): WorkforceDataPoint | null {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: null,
    });

    // Look for rows where a cell contains "total" and an adjacent cell
    // contains a number in a plausible range for police workforce (50k-200k)
    for (const row of rows) {
      if (!row) continue;

      let hasTotalKeyword = false;
      let largestNumber = 0;

      for (const cell of row) {
        const cellStr = String(cell ?? "").toLowerCase();
        if (
          cellStr.includes("total") &&
          (cellStr.includes("officer") ||
            cellStr.includes("police") ||
            cellStr.includes("workforce") ||
            cellStr.includes("strength"))
        ) {
          hasTotalKeyword = true;
        }

        const num = parseNumericCell(cell);
        if (num !== null && num > largestNumber) {
          largestNumber = num;
        }
      }

      // Police workforce total is typically 120k-170k
      if (hasTotalKeyword && largestNumber >= 50000 && largestNumber <= 300000) {
        return {
          date: titleDate.isoDate,
          label: titleDate.label,
          totalOfficers: 0,
          totalPCSOs: 0,
          totalSpecials: 0,
          combinedTotal: Math.round(largestNumber),
        };
      }
    }
  }

  return null;
}

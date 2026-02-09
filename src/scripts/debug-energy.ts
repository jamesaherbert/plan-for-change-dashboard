import * as XLSX from "xlsx";

const XLSX_URL =
  "https://assets.publishing.service.gov.uk/media/6941a0421ec67214e98f3044/ET_6.1_DEC_25.xlsx";

const CUTOFF_YEAR = 2020;

const QUARTER_MONTH_MAP: Record<string, string> = {
  Q1: "01",
  Q2: "04",
  Q3: "07",
  Q4: "10",
};

function quarterToIsoDate(year: number, quarter: string): string {
  const q = quarter.toUpperCase();
  const month = QUARTER_MONTH_MAP[q];
  if (!month) throw new Error(`Invalid quarter: ${quarter}`);
  return `${year}-${month}-01`;
}

function formatLabel(year: number, quarter: string): string {
  return `${quarter.toUpperCase()} ${year}`;
}

function parseNumericCell(cell: unknown): number | null {
  if (cell == null || cell === "" || cell === "-" || cell === ".." || cell === "[x]") return null;
  if (typeof cell === "number") return isNaN(cell) ? null : cell;
  if (typeof cell === "string") {
    const cleaned = cell.replace(/[%,\s]/g, "");
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }
  return null;
}

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
      return {
        isoDate: quarterToIsoDate(year, q),
        label: formatLabel(year, q),
      };
    }
  }

  // Match just a year "2024"
  const yearOnly = /^(\d{4})$/.exec(cleaned);
  if (yearOnly) {
    const year = parseInt(yearOnly[1], 10);
    if (year >= 1990 && year <= 2100) {
      return { isoDate: `${year}-01-01`, label: `${year}` };
    }
  }

  return null;
}

async function main() {
  console.log(`Downloading XLSX from: ${XLSX_URL}`);
  const res = await fetch(XLSX_URL);
  if (!res.ok) {
    console.error(`Failed to download: ${res.status}`);
    process.exit(1);
  }

  const arrayBuffer = await res.arrayBuffer();
  const workbook = XLSX.read(new Uint8Array(arrayBuffer), { type: "array" });

  console.log(`\nTesting transposed extraction on "Quarter" sheet...\n`);

  const sheet = workbook.Sheets["Quarter"];
  if (!sheet) {
    console.error("Quarter sheet not found");
    process.exit(1);
  }

  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    defval: null,
  });

  // Find shares header row
  let sharesHeaderRowIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const label = String(row[0] ?? "").toLowerCase();
    if (label.includes("share") && (label.includes("electric") || label.includes("generat"))) {
      sharesHeaderRowIdx = i;
      break;
    }
  }

  console.log(`Shares header row: ${sharesHeaderRowIdx}`);
  if (sharesHeaderRowIdx < 0) {
    console.error("Could not find shares header row");
    process.exit(1);
  }

  const headerRow = rows[sharesHeaderRowIdx];
  console.log(`Header row[0]: "${headerRow![0]}"`);

  // Parse column headers
  let validDateCols = 0;
  for (let j = 1; j < headerRow!.length; j++) {
    const text = String(headerRow![j] ?? "");
    const parsed = parseTransposedColumnHeader(text);
    if (parsed) validDateCols++;
  }
  console.log(`Valid date columns parsed: ${validDateCols}`);

  // Find "All renewables" row
  let renewablesRowIdx = -1;
  for (let i = sharesHeaderRowIdx + 1; i < Math.min(rows.length, sharesHeaderRowIdx + 20); i++) {
    const row = rows[i];
    if (!row) break;
    const label = String(row[0] ?? "").toLowerCase().trim();
    if (label.includes("all renewable")) {
      renewablesRowIdx = i;
      break;
    }
  }

  console.log(`All renewables row: ${renewablesRowIdx}`);
  if (renewablesRowIdx < 0) {
    console.error("Could not find 'All renewables' row");
    process.exit(1);
  }

  const dataRow = rows[renewablesRowIdx];
  console.log(`Data row[0]: "${dataRow![0]}"`);

  // Extract data points
  interface DataPoint {
    value: number;
    date: string;
    label: string;
  }
  const results: DataPoint[] = [];

  const columnDates: ({ isoDate: string; label: string } | null)[] = [null]; // col 0
  for (let j = 1; j < headerRow!.length; j++) {
    columnDates.push(parseTransposedColumnHeader(String(headerRow![j] ?? "")));
  }

  for (let j = 1; j < dataRow!.length; j++) {
    const rawValue = dataRow![j];
    let value = parseNumericCell(rawValue);
    if (value === null) continue;

    if (value > 0 && value < 1) {
      value = Math.round(value * 1000) / 10;
    } else {
      value = Math.round(value * 10) / 10;
    }

    const dateInfo = j < columnDates.length ? columnDates[j] : null;
    if (!dateInfo) continue;

    const year = new Date(dateInfo.isoDate).getFullYear();
    if (year < CUTOFF_YEAR) continue;

    results.push({ value, date: dateInfo.isoDate, label: dateInfo.label });
  }

  console.log(`\nExtracted ${results.length} data points (from ${CUTOFF_YEAR} onwards):\n`);
  for (const dp of results) {
    console.log(`  ${dp.label}: ${dp.value}% (${dp.date})`);
  }

  if (results.length > 0) {
    const latest = results[results.length - 1];
    console.log(`\nLatest: ${latest.value}% (${latest.label})`);
    console.log("\nSUCCESS: Transposed extraction works correctly.");
  } else {
    console.error("\nFAILURE: No data points extracted.");
  }
}

main().catch(console.error);

import { getDb } from "../db";
import { getMilestoneMapping } from "../milestones";
import type { MilestoneSlug, OutputType } from "../types";

// ---------------------------------------------------------------------------
// GOV.UK Search API fetcher
// Docs: https://docs.publishing.service.gov.uk/repos/search-api/
// ---------------------------------------------------------------------------

const GOVUK_SEARCH_URL = "https://www.gov.uk/api/search.json";
const FROM_DATE = "2024-07-01";
const PAGE_SIZE = 50;

const FIELDS = [
  "title",
  "description",
  "link",
  "public_timestamp",
  "organisations",
  "format",
  "content_store_document_type",
  "display_type",
].join(",");

/** Map GOV.UK content_store_document_type to our OutputType. */
function mapDocType(govukType: string): OutputType {
  const mapping: Record<string, OutputType> = {
    policy_paper: "policy_paper",
    consultation: "consultation",
    open_consultation: "consultation",
    closed_consultation: "consultation",
    consultation_outcome: "consultation",
    guidance: "guidance",
    detailed_guidance: "guidance",
    statutory_guidance: "guidance",
    statutory_instrument: "statutory_instrument",
    government_response: "government_response",
    impact_assessment: "impact_assessment",
    white_paper: "white_paper",
    independent_report: "committee_report",
    corporate_report: "policy_paper",
    notice: "guidance",
    regulation: "statutory_instrument",
    national_statistics: "policy_paper",
    official_statistics: "policy_paper",
    research: "policy_paper",
  };
  return mapping[govukType] ?? "policy_paper";
}

/** Generate a deterministic ID from a GOV.UK link path. */
function idFromLink(link: string): string {
  // Strip leading slash and replace remaining slashes with dashes
  return "govuk-" + link.replace(/^\//, "").replace(/\//g, "-");
}

interface GovukResult {
  title: string;
  description: string;
  link: string;
  public_timestamp: string;
  organisations?: Array<{ slug: string; title: string }>;
  format: string;
  content_store_document_type: string;
  display_type: string;
}

interface GovukSearchResponse {
  results: GovukResult[];
  total: number;
}

async function searchGovuk(params: URLSearchParams): Promise<GovukResult[]> {
  const url = `${GOVUK_SEARCH_URL}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `GOV.UK Search API error: ${res.status} ${res.statusText} for ${url}`
    );
    return [];
  }
  const data = (await res.json()) as GovukSearchResponse;
  return data.results ?? [];
}

/**
 * Fetch Whitehall outputs from the GOV.UK Search API for a given milestone
 * and upsert them into the outputs table.
 */
export async function fetchGovukOutputs(
  milestoneSlug: MilestoneSlug
): Promise<void> {
  const mapping = getMilestoneMapping(milestoneSlug);
  if (!mapping) {
    console.error(`No milestone mapping found for slug: ${milestoneSlug}`);
    return;
  }

  const seen = new Set<string>(); // deduplicate by link
  const results: Array<{ result: GovukResult; confidence: "high" | "medium" }> =
    [];

  // 1. Department-scoped searches (high confidence) --------------------------
  for (const dept of mapping.departments) {
    for (const docType of mapping.govukDocTypes) {
      for (const term of mapping.govukSearchTerms) {
        const params = new URLSearchParams({
          q: term,
          filter_organisations: dept,
          filter_content_store_document_type: docType,
          "filter_public_timestamp": `from:${FROM_DATE}`,
          count: String(PAGE_SIZE),
          start: "0",
          fields: FIELDS,
        });

        try {
          const items = await searchGovuk(params);
          for (const item of items) {
            if (!seen.has(item.link)) {
              seen.add(item.link);
              results.push({ result: item, confidence: "high" });
            }
          }
        } catch (err) {
          console.error(
            `GOV.UK fetch error (dept=${dept}, term=${term}):`,
            err
          );
        }
      }
    }
  }

  // 2. Keyword-only searches (medium confidence) -----------------------------
  for (const term of mapping.govukSearchTerms) {
    for (const docType of mapping.govukDocTypes) {
      const params = new URLSearchParams({
        q: term,
        filter_content_store_document_type: docType,
        "filter_public_timestamp": `from:${FROM_DATE}`,
        count: String(PAGE_SIZE),
        start: "0",
        fields: FIELDS,
      });

      try {
        const items = await searchGovuk(params);
        for (const item of items) {
          if (!seen.has(item.link)) {
            seen.add(item.link);
            results.push({ result: item, confidence: "medium" });
          }
        }
      } catch (err) {
        console.error(`GOV.UK fetch error (keyword term=${term}):`, err);
      }
    }
  }

  // 3. Upsert into DB --------------------------------------------------------
  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO outputs
      (id, milestone_slug, type, title, description, url, source, status,
       published_date, last_updated, department, confidence, dismissed)
    VALUES
      (?, ?, ?, ?, ?, ?, 'govuk', '', ?, ?, ?, ?, 0)
  `);

  const upsertMany = db.transaction(
    (
      items: Array<{ result: GovukResult; confidence: "high" | "medium" }>
    ) => {
      for (const { result, confidence } of items) {
        const id = idFromLink(result.link);
        const outputType = mapDocType(result.content_store_document_type);
        const url = `https://www.gov.uk${result.link}`;
        const department =
          result.organisations?.[0]?.title ?? mapping.departments[0] ?? "";
        const publishedDate = result.public_timestamp
          ? result.public_timestamp.slice(0, 10)
          : "";

        upsert.run(
          id,
          milestoneSlug,
          outputType,
          result.title,
          result.description ?? "",
          url,
          publishedDate,
          publishedDate, // last_updated = published_date initially
          department,
          confidence
        );
      }
    }
  );

  upsertMany(results);

  console.log(
    `[govuk-search] Upserted ${results.length} outputs for "${milestoneSlug}"`
  );
}

import { getDb } from "../db";
import { getMilestoneMapping } from "../milestones";
import type { MilestoneSlug } from "../types";

// ---------------------------------------------------------------------------
// Guardian Open Platform API fetcher
// Docs: https://open-platform.theguardian.com/documentation/
// ---------------------------------------------------------------------------

const GUARDIAN_API_URL = "https://content.guardianapis.com/search";
const FROM_DATE = "2024-07-01";
const PAGE_SIZE = 20;

interface GuardianResult {
  id: string; // e.g. "politics/2025/jan/15/some-article"
  type: string;
  sectionId: string;
  sectionName: string;
  webPublicationDate: string;
  webTitle: string;
  webUrl: string;
  apiUrl: string;
  fields?: {
    trailText?: string;
    thumbnail?: string;
    byline?: string;
  };
}

interface GuardianSearchResponse {
  response: {
    status: string;
    total: number;
    startIndex: number;
    pageSize: number;
    currentPage: number;
    pages: number;
    results: GuardianResult[];
  };
}

/**
 * Generate a deterministic article ID from the Guardian id path.
 */
function idFromGuardianPath(guardianId: string): string {
  return "guardian-" + guardianId.replace(/\//g, "-");
}

/**
 * Build Guardian API request params and fetch results.
 */
async function searchGuardian(params: {
  q?: string;
  tag?: string;
}): Promise<GuardianResult[]> {
  const apiKey = process.env.GUARDIAN_API_KEY;
  if (!apiKey) {
    console.error(
      "[guardian] GUARDIAN_API_KEY environment variable is not set"
    );
    return [];
  }

  const searchParams = new URLSearchParams({
    "from-date": FROM_DATE,
    "order-by": "newest",
    "show-fields": "trailText,thumbnail,byline",
    "page-size": String(PAGE_SIZE),
    "api-key": apiKey,
  });

  if (params.q) searchParams.set("q", params.q);
  if (params.tag) searchParams.set("tag", params.tag);

  const url = `${GUARDIAN_API_URL}?${searchParams.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(
      `Guardian API error: ${res.status} ${res.statusText} for ${url}`
    );
    return [];
  }

  const data = (await res.json()) as GuardianSearchResponse;
  return data.response?.results ?? [];
}

/**
 * Upsert an array of Guardian results into the media_articles table.
 */
function upsertArticles(
  milestoneSlug: MilestoneSlug,
  articles: GuardianResult[],
  outputId?: string
): number {
  const db = getDb();

  const insert = db.prepare(`
    INSERT OR IGNORE INTO media_articles
      (id, milestone_slug, output_id, title, url, source, published_date,
       excerpt, thumbnail_url, api_source)
    VALUES
      (?, ?, ?, ?, ?, 'The Guardian', ?, ?, ?, 'guardian')
  `);

  let inserted = 0;

  const insertMany = db.transaction((items: GuardianResult[]) => {
    for (const article of items) {
      const id = idFromGuardianPath(article.id);
      const publishedDate = article.webPublicationDate
        ? article.webPublicationDate.slice(0, 10)
        : "";

      const result = insert.run(
        id,
        milestoneSlug,
        outputId ?? null,
        article.webTitle,
        article.webUrl,
        publishedDate,
        article.fields?.trailText ?? null,
        article.fields?.thumbnail ?? null
      );

      if (result.changes > 0) inserted++;
    }
  });

  insertMany(articles);
  return inserted;
}

/**
 * Fetch Guardian articles for general milestone coverage.
 */
export async function fetchGuardianForMilestone(
  milestoneSlug: MilestoneSlug
): Promise<void> {
  const mapping = getMilestoneMapping(milestoneSlug);
  if (!mapping) {
    console.error(`No milestone mapping found for slug: ${milestoneSlug}`);
    return;
  }

  const allResults: GuardianResult[] = [];
  const seen = new Set<string>();

  // Search by tags
  if (mapping.guardianTags.length > 0) {
    const tagQuery = mapping.guardianTags.join("|");
    try {
      const results = await searchGuardian({ tag: tagQuery });
      for (const r of results) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allResults.push(r);
        }
      }
    } catch (err) {
      console.error(`Guardian tag search error:`, err);
    }
  }

  // Search by keywords
  for (const term of mapping.guardianSearchTerms) {
    try {
      const results = await searchGuardian({ q: term });
      for (const r of results) {
        if (!seen.has(r.id)) {
          seen.add(r.id);
          allResults.push(r);
        }
      }
    } catch (err) {
      console.error(`Guardian keyword search error (term="${term}"):`, err);
    }
  }

  const inserted = upsertArticles(milestoneSlug, allResults);
  console.log(
    `[guardian] Inserted ${inserted} new articles (${allResults.length} fetched) for "${milestoneSlug}"`
  );
}

/**
 * Fetch Guardian articles about a specific output (e.g. a bill or policy paper).
 */
export async function fetchGuardianForOutput(
  milestoneSlug: MilestoneSlug,
  outputId: string,
  outputTitle: string
): Promise<void> {
  try {
    const results = await searchGuardian({ q: outputTitle });
    const inserted = upsertArticles(milestoneSlug, results, outputId);
    console.log(
      `[guardian] Inserted ${inserted} new articles for output "${outputId}" (${results.length} fetched)`
    );
  } catch (err) {
    console.error(
      `Guardian output search error (outputId="${outputId}"):`,
      err
    );
  }
}

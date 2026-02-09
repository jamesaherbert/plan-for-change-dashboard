import { getDb } from "../db";
import { getMilestoneMapping } from "../milestones";
import type { MilestoneSlug } from "../types";

// ---------------------------------------------------------------------------
// TheyWorkForYou API fetcher — debates + written questions
// Docs: https://www.theyworkforyou.com/api/
// ---------------------------------------------------------------------------

const TWFY_API_URL = "https://www.theyworkforyou.com/api";
const FROM_DATE = "2024-07-01"; // Current parliament

interface TwfyDebateResult {
  gid: string;
  parent?: { body: string };
  body: string;
  hdate: string;
  htype: string; // "12" = Commons debate, "101" = Lords, "14" = Westminster Hall
  listurl: string;
}

interface TwfyWransResult {
  gid: string;
  body: string;
  hdate: string;
  listurl: string;
  speaker?: {
    name: string;
  };
  answered?: boolean;
}

function getApiKey(): string | null {
  const key = process.env.TWFY_API_KEY;
  if (!key) {
    console.error("[twfy] TWFY_API_KEY environment variable is not set");
    return null;
  }
  return key;
}

function houseFromType(htype: string): "Commons" | "Lords" | "Westminster Hall" {
  switch (htype) {
    case "12":
    case "13":
      return "Commons";
    case "101":
      return "Lords";
    case "14":
      return "Westminster Hall";
    default:
      return "Commons";
  }
}

/**
 * Search TheyWorkForYou for Hansard debates matching a search term.
 */
async function searchDebates(
  apiKey: string,
  searchTerm: string
): Promise<TwfyDebateResult[]> {
  const params = new URLSearchParams({
    key: apiKey,
    s: searchTerm,
    num: "20",
    output: "json",
  });

  const url = `${TWFY_API_URL}/getDebates?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[twfy] Debates API error: ${res.status} for ${url}`);
    return [];
  }

  const data = await res.json();
  if (Array.isArray(data)) {
    return data as TwfyDebateResult[];
  }
  if (data?.rows && Array.isArray(data.rows)) {
    return data.rows as TwfyDebateResult[];
  }
  return [];
}

/**
 * Search TheyWorkForYou for written questions/answers.
 */
async function searchWrans(
  apiKey: string,
  searchTerm: string
): Promise<TwfyWransResult[]> {
  const params = new URLSearchParams({
    key: apiKey,
    s: searchTerm,
    num: "20",
    output: "json",
  });

  const url = `${TWFY_API_URL}/getWrans?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`[twfy] Wrans API error: ${res.status} for ${url}`);
    return [];
  }

  const data = await res.json();
  if (Array.isArray(data)) {
    return data as TwfyWransResult[];
  }
  if (data?.rows && Array.isArray(data.rows)) {
    return data.rows as TwfyWransResult[];
  }
  return [];
}

/**
 * Strip HTML tags from a string and truncate.
 */
function cleanText(html: string, maxLen = 200): string {
  const text = html.replace(/<[^>]*>/g, "").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}

/**
 * Fetch debates from TheyWorkForYou for a given milestone.
 */
export async function fetchDebates(
  milestoneSlug: MilestoneSlug
): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const mapping = getMilestoneMapping(milestoneSlug);
  if (!mapping) {
    console.error(`No milestone mapping found for slug: ${milestoneSlug}`);
    return;
  }

  if (mapping.debateSearchTerms.length === 0) {
    console.log(`[twfy] No debate search terms for "${milestoneSlug}", skipping.`);
    return;
  }

  const seenGids = new Set<string>();
  const debates: Array<{
    id: string;
    title: string;
    date: string;
    house: "Commons" | "Lords" | "Westminster Hall";
    url: string;
  }> = [];

  for (const term of mapping.debateSearchTerms) {
    try {
      const results = await searchDebates(apiKey, term);
      for (const r of results) {
        if (!r.gid || seenGids.has(r.gid)) continue;
        if (r.hdate < FROM_DATE) continue;
        seenGids.add(r.gid);

        const title = r.parent?.body
          ? cleanText(r.parent.body)
          : cleanText(r.body, 120);
        const baseUrl = "https://www.theyworkforyou.com";
        const url = r.listurl?.startsWith("http")
          ? r.listurl
          : `${baseUrl}${r.listurl || `/debate/?id=${r.gid}`}`;

        debates.push({
          id: `twfy-debate-${r.gid}`,
          title,
          date: r.hdate,
          house: houseFromType(r.htype),
          url,
        });
      }
    } catch (err) {
      console.error(`[twfy] Debate search error (term="${term}"):`, err);
    }
  }

  if (debates.length === 0) {
    console.log(`[twfy] No debates found for "${milestoneSlug}"`);
    return;
  }

  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO debates
      (id, milestone_slug, title, date, house, url, source)
    VALUES (?, ?, ?, ?, ?, ?, 'theyworkforyou')
  `);

  const insertAll = db.transaction(
    (items: typeof debates) => {
      for (const d of items) {
        upsert.run(d.id, milestoneSlug, d.title, d.date, d.house, d.url);
      }
    }
  );

  insertAll(debates);
  console.log(
    `[twfy] Stored ${debates.length} debates for "${milestoneSlug}"`
  );
}

/**
 * Fetch written questions from TheyWorkForYou for a given milestone.
 */
export async function fetchWrittenQuestions(
  milestoneSlug: MilestoneSlug
): Promise<void> {
  const apiKey = getApiKey();
  if (!apiKey) return;

  const mapping = getMilestoneMapping(milestoneSlug);
  if (!mapping) {
    console.error(`No milestone mapping found for slug: ${milestoneSlug}`);
    return;
  }

  // Use the same debate search terms for written questions
  const searchTerms = mapping.debateSearchTerms;
  if (searchTerms.length === 0) {
    console.log(`[twfy] No search terms for written questions for "${milestoneSlug}", skipping.`);
    return;
  }

  const seenGids = new Set<string>();
  const questions: Array<{
    id: string;
    title: string;
    askedBy: string;
    date: string;
    url: string;
    answered: boolean;
  }> = [];

  for (const term of searchTerms) {
    try {
      const results = await searchWrans(apiKey, term);
      for (const r of results) {
        if (!r.gid || seenGids.has(r.gid)) continue;
        if (r.hdate < FROM_DATE) continue;
        seenGids.add(r.gid);

        const title = cleanText(r.body, 200);
        const baseUrl = "https://www.theyworkforyou.com";
        const url = r.listurl?.startsWith("http")
          ? r.listurl
          : `${baseUrl}${r.listurl || `/wrans/?id=${r.gid}`}`;

        questions.push({
          id: `twfy-wq-${r.gid}`,
          title,
          askedBy: r.speaker?.name ?? "",
          date: r.hdate,
          url,
          answered: r.answered ?? false,
        });
      }
    } catch (err) {
      console.error(`[twfy] Written question search error (term="${term}"):`, err);
    }
  }

  if (questions.length === 0) {
    console.log(`[twfy] No written questions found for "${milestoneSlug}"`);
    return;
  }

  const db = getDb();
  const upsert = db.prepare(`
    INSERT OR REPLACE INTO written_questions
      (id, milestone_slug, question_title, asked_by, date, url, answered)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(
    (items: typeof questions) => {
      for (const q of items) {
        upsert.run(
          q.id,
          milestoneSlug,
          q.title,
          q.askedBy,
          q.date,
          q.url,
          q.answered ? 1 : 0
        );
      }
    }
  );

  insertAll(questions);
  console.log(
    `[twfy] Stored ${questions.length} written questions for "${milestoneSlug}"`
  );
}

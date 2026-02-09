import { getDb } from "../db";
import { getMilestoneMapping } from "../milestones";
import type { MilestoneSlug } from "../types";

// ---------------------------------------------------------------------------
// UK Parliament Committees API fetcher
// Docs: https://committees-api.parliament.uk/index.html
//
// Uses the /api/CommitteeBusiness endpoint filtered by CommitteeId to get
// inquiries for each committee. The /api/Committees/{id} endpoint provides
// committee name/details.
// ---------------------------------------------------------------------------

const COMMITTEES_API_BASE = "https://committees-api.parliament.uk/api";
const FROM_DATE = "2024-07-01"; // Current parliament

interface CommitteeDetailsResponse {
  id: number;
  name: string;
}

interface CommitteeBusinessType {
  id: number;
  name: string;
  isInquiry: boolean;
}

interface CommitteeBusinessItem {
  id: number;
  title: string;
  type: CommitteeBusinessType;
  openDate: string;
  closeDate: string | null;
  latestReport: {
    description: string;
    id: number;
    publicationStartDate: string;
  } | null;
}

interface CommitteeBusinessResponse {
  items: CommitteeBusinessItem[];
  totalResults: number;
}

async function fetchCommitteeDetails(
  committeeId: number
): Promise<CommitteeDetailsResponse | null> {
  try {
    const url = `${COMMITTEES_API_BASE}/Committees/${committeeId}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) {
      console.error(
        `[committees] API error: ${res.status} for GET /Committees/${committeeId}`
      );
      return null;
    }
    return (await res.json()) as CommitteeDetailsResponse;
  } catch (err) {
    console.error(`[committees] Fetch error for committee ${committeeId}:`, err);
    return null;
  }
}

async function fetchCommitteeBusiness(
  committeeId: number
): Promise<CommitteeBusinessItem[]> {
  try {
    const params = new URLSearchParams({
      CommitteeId: committeeId.toString(),
      DateFrom: FROM_DATE,
      Take: "50",
    });
    const url = `${COMMITTEES_API_BASE}/CommitteeBusiness?${params.toString()}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error(
        `[committees] API error: ${res.status} for CommitteeBusiness?CommitteeId=${committeeId}`
      );
      return [];
    }
    const data = (await res.json()) as CommitteeBusinessResponse;
    return data.items ?? [];
  } catch (err) {
    console.error(`[committees] Fetch error for committee business ${committeeId}:`, err);
    return [];
  }
}

interface FetchedInquiry {
  committeeId: number;
  committeeName: string;
  item: CommitteeBusinessItem;
}

/**
 * Fetch committee inquiries from the UK Parliament Committees API
 * for a given milestone and store them in the committee_inquiries table.
 */
export async function fetchCommitteeInquiries(
  milestoneSlug: MilestoneSlug
): Promise<void> {
  const mapping = getMilestoneMapping(milestoneSlug);
  if (!mapping) {
    console.error(`No milestone mapping found for slug: ${milestoneSlug}`);
    return;
  }

  if (mapping.committeeIds.length === 0) {
    console.log(
      `[committees] No committee IDs for "${milestoneSlug}", skipping.`
    );
    return;
  }

  const allInquiries: FetchedInquiry[] = [];

  for (const committeeId of mapping.committeeIds) {
    const committee = await fetchCommitteeDetails(committeeId);
    if (!committee) continue;

    console.log(
      `[committees] Fetching inquiries for "${committee.name}" (ID: ${committeeId})...`
    );

    const items = await fetchCommitteeBusiness(committeeId);

    // Only include inquiry-type business items
    for (const item of items) {
      if (item.type?.isInquiry) {
        allInquiries.push({
          committeeId,
          committeeName: committee.name,
          item,
        });
      }
    }
  }

  if (allInquiries.length === 0) {
    console.log(`[committees] No inquiries found for "${milestoneSlug}"`);
    return;
  }

  const db = getDb();

  const upsert = db.prepare(`
    INSERT OR REPLACE INTO committee_inquiries
      (id, milestone_slug, committee_name, committee_id,
       inquiry_title, status, url, evidence_sessions,
       reports_published, last_activity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const writeAll = db.transaction((items: FetchedInquiry[]) => {
    for (const { committeeId, committeeName, item } of items) {
      const inquiryId = `committee-${committeeId}-${item.id}`;
      const inquiryUrl = `https://committees.parliament.uk/work/${item.id}`;

      // Determine status
      let status: string;
      if (!item.closeDate) {
        status = "Open";
      } else {
        const closed = new Date(item.closeDate);
        status = closed > new Date() ? "Open" : "Closed";
      }

      const reportsPublished = item.latestReport ? 1 : 0;

      // Use the latest date we have
      const lastActivity =
        item.latestReport?.publicationStartDate?.slice(0, 10) ??
        item.closeDate?.slice(0, 10) ??
        item.openDate?.slice(0, 10) ??
        null;

      upsert.run(
        inquiryId,
        milestoneSlug,
        committeeName,
        committeeId,
        item.title,
        status,
        inquiryUrl,
        0,
        reportsPublished,
        lastActivity
      );
    }
  });

  writeAll(allInquiries);

  console.log(
    `[committees] Upserted ${allInquiries.length} inquiries for "${milestoneSlug}"`
  );
}

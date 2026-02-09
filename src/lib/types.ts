// Core data model for the Plan for Change dashboard

export type MilestoneSlug =
  | "economic-growth"
  | "housing"
  | "nhs"
  | "policing"
  | "education"
  | "clean-energy";

export interface Milestone {
  slug: MilestoneSlug;
  title: string;
  shortTitle: string;
  description: string;
  targetValue: number;
  targetUnit: string;
  targetDate: string; // e.g. "Spring 2029" or "2030"
  currentValue?: number;
  currentDate?: string;
  kpiLabel: string; // e.g. "% within 18 weeks"
  higherIsBetter: boolean;
}

export interface KpiSnapshot {
  id?: number;
  milestoneSlug: MilestoneSlug;
  value: number;
  date: string; // ISO date string for the period this value covers
  label?: string; // e.g. "Q3 2025", "August 2025"
  fetchedAt: string; // ISO datetime when we fetched this
}

export type OutputType =
  | "bill"
  | "policy_paper"
  | "consultation"
  | "guidance"
  | "statutory_instrument"
  | "framework"
  | "action_plan"
  | "committee_report"
  | "government_response"
  | "white_paper"
  | "impact_assessment";

export type OutputSource = "parliament" | "govuk" | "legislation" | "manual";
export type Confidence = "high" | "medium" | "low";

export interface Output {
  id: string;
  milestoneSlug: MilestoneSlug;
  type: OutputType;
  title: string;
  description: string;
  url: string;
  source: OutputSource;
  status: string;
  publishedDate: string;
  lastUpdated: string;
  department?: string;
  confidence: Confidence;
  dismissed: boolean;
  // Populated at query time, not stored in the same table
  mediaArticleCount?: number;
  recentMediaCount?: number; // articles in last 7 days
}

export interface BillStage {
  name: string;
  house: "Commons" | "Lords";
  date?: string;
  completed: boolean;
}

export interface BillDetail extends Output {
  type: "bill";
  stages: BillStage[];
  currentStage: string;
  originatingHouse: "Commons" | "Lords";
  billId: number; // Parliament API bill ID
}

export interface MediaArticle {
  id: string;
  milestoneSlug: MilestoneSlug;
  outputId?: string; // linked to a specific output, or null for general coverage
  title: string;
  url: string;
  source: string; // e.g. "The Guardian", "BBC News"
  publishedDate: string;
  excerpt?: string; // trailText or description
  thumbnailUrl?: string;
  apiSource: "guardian" | "newsapi"; // which API it came from
  fetchedAt: string;
}

export interface CommitteeInquiry {
  id: string;
  milestoneSlug: MilestoneSlug;
  committeeName: string;
  committeeId: number;
  inquiryTitle: string;
  status: "Open" | "Closed" | "Reporting";
  url: string;
  evidenceSessions: number;
  reportsPublished: number;
  lastActivity?: string;
}

export interface Debate {
  id: string;
  milestoneSlug: MilestoneSlug;
  title: string;
  date: string;
  house: "Commons" | "Lords" | "Westminster Hall";
  url: string;
  source: "theyworkforyou" | "hansard";
}

export interface WrittenQuestion {
  id: string;
  milestoneSlug: MilestoneSlug;
  questionTitle: string;
  askedBy: string;
  date: string;
  url: string;
  answered: boolean;
}

// Configuration types for milestone-mappings.json
export interface MilestoneMapping {
  slug: MilestoneSlug;
  title: string;
  shortTitle: string;
  description: string;
  target: {
    value: number;
    unit: string;
    date: string;
    higherIsBetter: boolean;
    kpiLabel: string;
  };
  departments: string[]; // GOV.UK org slugs
  govukSearchTerms: string[];
  govukDocTypes: string[];
  billSearchTerms: string[];
  billExcludeTerms: string[];
  committeeIds: number[];
  debateSearchTerms: string[];
  guardianTags: string[];
  guardianSearchTerms: string[];
  legislationSearchTerms: string[];
}

// Dashboard view models
export interface MilestoneOverview {
  milestone: Milestone;
  latestKpi?: KpiSnapshot;
  kpiHistory: KpiSnapshot[];
  outputCount: number;
  recentMediaCount: number;
  billCount: number;
}

export interface MilestoneDetail {
  milestone: Milestone;
  kpiHistory: KpiSnapshot[];
  outputs: Output[];
  bills: BillDetail[];
  committees: CommitteeInquiry[];
  debates: Debate[];
  writtenQuestions: WrittenQuestion[];
  mediaArticles: MediaArticle[];
  generalMedia: MediaArticle[]; // not linked to specific outputs
}

import type { MilestoneMapping, MilestoneSlug, Milestone } from "./types";
import mappingsData from "../../data/milestone-mappings.json";

export const milestoneMappings: MilestoneMapping[] =
  mappingsData as MilestoneMapping[];

export function getMilestoneMapping(
  slug: MilestoneSlug
): MilestoneMapping | undefined {
  return milestoneMappings.find((m) => m.slug === slug);
}

export function getMilestone(slug: MilestoneSlug): Milestone {
  const mapping = getMilestoneMapping(slug);
  if (!mapping) throw new Error(`Unknown milestone: ${slug}`);
  return {
    slug: mapping.slug,
    title: mapping.title,
    shortTitle: mapping.shortTitle,
    description: mapping.description,
    targetValue: mapping.target.value,
    targetUnit: mapping.target.unit,
    targetDate: mapping.target.date,
    kpiLabel: mapping.target.kpiLabel,
    higherIsBetter: mapping.target.higherIsBetter,
  };
}

export function getAllMilestones(): Milestone[] {
  return milestoneMappings.map((m) => getMilestone(m.slug));
}

export const MILESTONE_SLUGS: MilestoneSlug[] = [
  "economic-growth",
  "housing",
  "nhs",
  "policing",
  "education",
  "clean-energy",
];

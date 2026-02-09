import type { MEFramework, MilestoneSlug } from "./types";
import frameworkData from "../../data/me-framework.json";

export const meFrameworks: MEFramework[] = frameworkData as MEFramework[];

export function getMEFramework(
  slug: MilestoneSlug
): MEFramework | undefined {
  return meFrameworks.find((f) => f.slug === slug);
}

export function getAllMEFrameworks(): MEFramework[] {
  return meFrameworks;
}

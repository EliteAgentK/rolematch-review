// Which skills appear on a compact card, and in what order.
// Skills come from the CV in the order the CV gives them; that order is kept. "Most recent" is judged from the work history the CV
// itself provides: a skill that appears in the newest role comes before one that only appears in an older role, which comes before
// skills that are only listed. Ties keep the CV's own order, so nothing is ever shuffled.

export interface RoleLike { position?: string; responsibilities?: string[] }

const mentions = (text: string, skill: string) => {
  const s = skill.toLowerCase().trim();
  if (s.length < 2) return false;
  const escaped = s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(text.toLowerCase());
};

/** Skills ordered newest-evidence first, preserving the CV's order among equals. Work history is expected newest first, as CVs list it. */
export function orderSkillsByRecency(skills: string[] = [], workHistory: RoleLike[] = []): string[] {
  const rank = (skill: string) => {
    const i = workHistory.findIndex((r) => mentions(`${r.position ?? ""} ${(r.responsibilities ?? []).join(" ")}`, skill));
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return skills.map((skill, index) => ({ skill, index, rank: rank(skill) })).sort((a, b) => a.rank - b.rank || a.index - b.index).map((x) => x.skill);
}

export interface SkillSplit { shown: string[]; hidden: string[]; hiddenCount: number }

/** The first three skills for a card and the exact rest, e.g. "View 69 more". */
export function splitSkills(ordered: string[], visible = 3): SkillSplit {
  const unique = [...new Set(ordered.filter(Boolean))];
  return { shown: unique.slice(0, visible), hidden: unique.slice(visible), hiddenCount: Math.max(0, unique.length - visible) };
}

import { describe, expect, test } from "vitest";
import { orderSkillsByRecency, splitSkills } from "./skillOrder";

describe("which skills a compact card shows", () => {
  const roles = [
    { position: "Lead Engineer", responsibilities: ["Built React and TypeScript front ends."] },       // newest
    { position: "Developer", responsibilities: ["Wrote SQL reports and Python scripts."] },           // older
  ];
  test("a skill used in the newest role comes first, then older roles, then skills that are only listed", () => {
    expect(orderSkillsByRecency(["Excel", "SQL", "React", "Python", "TypeScript"], roles)).toEqual(["React", "TypeScript", "SQL", "Python", "Excel"]);
  });
  test("ties keep the CV's own order: nothing is shuffled", () => {
    const listedOnly = ["Welding", "Pipe fitting", "Rigging", "Safety"];
    expect(orderSkillsByRecency(listedOnly, roles)).toEqual(listedOnly);
    expect(orderSkillsByRecency(listedOnly, [])).toEqual(listedOnly);
  });
  test("whole words only: Java is not evidenced by JavaScript", () => {
    expect(orderSkillsByRecency(["Java", "JavaScript"], [{ position: "Dev", responsibilities: ["Wrote JavaScript."] }])).toEqual(["JavaScript", "Java"]);
  });
  test("no skills or no history is safe", () => {
    expect(orderSkillsByRecency(undefined, undefined)).toEqual([]);
  });
});

describe("three visible skills and an exact count of the rest", () => {
  const many = Array.from({ length: 72 }, (_, i) => `Skill ${i + 1}`);
  test("72 skills: three shown, 69 more, nothing lost", () => {
    const s = splitSkills(many);
    expect(s.shown).toEqual(["Skill 1", "Skill 2", "Skill 3"]);
    expect(s.hiddenCount).toBe(69);
    expect(s.hidden.length).toBe(69);
    expect([...s.shown, ...s.hidden]).toEqual(many);
  });
  test("three or fewer: no 'view more'", () => {
    expect(splitSkills(["A", "B", "C"]).hiddenCount).toBe(0);
    expect(splitSkills(["A"]).shown).toEqual(["A"]);
    expect(splitSkills([]).hiddenCount).toBe(0);
  });
  test("duplicates are counted once so the number is exact", () => {
    expect(splitSkills(["A", "B", "C", "D", "D", "E"]).hiddenCount).toBe(2);
  });
});

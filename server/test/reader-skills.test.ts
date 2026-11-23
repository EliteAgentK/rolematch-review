// R149: skills the platform made up or cut short. Each case is shaped like one found in the real CVs, with invented words.
import { expect, test } from "vitest";
import { endsInDocument, inDocument, skillsOf, SKILL_LIMIT, validateReading } from "../src/modelReader";

test("several skills run together become one each, and names with a slash or a version bracket stay whole", () => {
  expect(skillsOf("VPN, ACTIVE SYNC, MICROSOFT LYNC, CISCO JABBER")).toEqual(["VPN", "ACTIVE SYNC", "MICROSOFT LYNC", "CISCO JABBER"]);
  expect(skillsOf("ASP.NET Core/MVC/C#")).toEqual(["ASP.NET Core", "MVC", "C#"]);
  expect(skillsOf("CMS Experience (Umbraco, WordPress, SharePoint)")).toEqual(["CMS Experience", "Umbraco", "WordPress", "SharePoint"]);
  for (const whole of ["CI/CD", "PL/SQL", "TCP/IP", "C++", ".NET Framework (3.5, 4.0 and 4.5)", "Research and Development"]) expect(skillsOf(whole)).toEqual([whole]);
  expect(skillsOf("AVAYA AND CISCO ⮚")).toEqual(["AVAYA AND CISCO"]);
  expect(skillsOf("Blob Storage)")).toEqual(["Blob Storage"]);
  expect(skillsOf("Adobe Audition/After Effects/Photoshop (elementary")).toEqual(["Adobe Audition", "After Effects", "Photoshop"]);
});

test("a value with letters the document never uses is not in the document, whatever its other words", () => {
  const cv = "Ability to take accountability and constructive criticism";
  expect(inDocument("constructive criticism", cv)).toBe(true);
  expect(inDocument("constructive批评", cv)).toBe(false);
});

test("a skill cut at the format's limit keeps what the document holds whole, and loses only the cut word", () => {
  const cv = "SKILLS\nBootstrap, C# and VB.NET, MVC, Web API, JWT, Entity Framework\nOffice: Ms. Excel Ms. PowerPoint Ms. Word Ms. Project\nTools: Grafana";
  expect(endsInDocument("Entit", cv)).toBe(false);
  expect(endsInDocument("Entity Framework", cv)).toBe(true);
  const cut = "Bootstrap, C# and VB.NET, MVC, Web API, JWT, Entit", list = "Office: Ms. Excel Ms. PowerPoint Ms.Word Ms. Pro";
  expect(cut.length).toBe(SKILL_LIMIT);
  const r = validateReading({ roles: [], education: [], certifications: [], skills: [cut, list.padEnd(SKILL_LIMIT, "j").slice(0, SKILL_LIMIT), "Grafana"], languages: [], location: "", agency: {} }, cv);
  expect(r.skills).toContain("Web API");
  expect(r.skills).toContain("JWT");
  expect(r.skills).not.toContain("Entit");
  expect(r.skills).toContain("Office: Ms. Excel Ms. PowerPoint");
  expect(r.skills).toContain("Grafana");
});


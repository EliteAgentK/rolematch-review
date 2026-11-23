// R150: the card's headline role. The model reads what the CV presents the person as; code holds it to the document; the rules' reading stands only where the model gave none. Invented CV, laid out like the real one: a label column read before its values, and a value wrapped onto two lines.
import { expect, test } from "vitest";
import { validateReading } from "../src/modelReader";
import { mergeReading } from "../src/reconcile";

const cv = ["NAME AND SURNAME", "POSITION APPLIED FOR", "NATIONALITY", "Page 2 of 9", "PERSONAL DETAILS", "THANDO REUBEN KHUMALO", "CLOUD COLLABORATION PRODUCTIVITY CONSULTING", "ENGINEER", "SOUTH AFRICAN", "Contact 071 555 0199", "EMPLOYMENT", "Key Accounts Manager", "Riverbend Projects", "May 2020 - Present"].join("\n");
const answer = (headline: string) => ({ headline, roles: [], education: [], certifications: [], skills: [], languages: [], location: "", agency: {} });

test("a title wrapped over two lines is one headline, held to the document's words", () => {
  expect(validateReading(answer("Cloud Collaboration Productivity Consulting Engineer"), cv).headline).toBe("Cloud Collaboration Productivity Consulting Engineer");
});

test("a headline the document does not hold, or a number, is refused", () => {
  expect(validateReading(answer("Chief Technology Officer"), cv).headline).toBe("");
  expect(validateReading(answer("071 555 0199"), cv).headline).toBe("");
});

test("the model's headline leads the card, the rules' reading is kept beside it, and with no headline the rules' reading stands", () => {
  const record = { role: "ENGINEER", skills: [], workHistory: [] }, read = (headline: string) => ({ reading: { ...validateReading(answer(headline), cv), refused: 0 }, roles: [], employment: { state: "supported" as const, reasons: [] }, trace: {}, text: cv });
  const merged = mergeReading(record, read("Cloud Collaboration Productivity Consulting Engineer"), { model: "m", promptVersion: "p" });
  expect(merged.role).toBe("Cloud Collaboration Productivity Consulting Engineer");
  expect(merged.rulesRole).toBe("ENGINEER");
  expect(mergeReading(record, read(""), { model: "m", promptVersion: "p" }).role).toBe("ENGINEER");
});

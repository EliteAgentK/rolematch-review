import { expect, test } from "vitest";
import { layoutFamily } from "../src/templates";

test("a LinkedIn export is recognised by its headings and footer, not by name alone", () => {
  const text = "Contact\nwww.linkedin.com/in/thandi-mokoena\nTop Skills\nSQL\nLanguages\nEnglish\nThandi Mokoena\nPage 1 of 3";
  expect(layoutFamily({ kind: "pdf", text }).family).toBe("linkedin-export");
  expect(layoutFamily({ kind: "pdf", text: "Contact\nTop Skills" }).family).toBe("other");   // two headings and no footer or profile link is not enough
});

test("design tools and Europass are recognised, photos are labelled as such, the rest is other", () => {
  expect(layoutFamily({ kind: "pdf", producer: "Canva", text: "x" }).family).toBe("canva");
  expect(layoutFamily({ kind: "pdf", text: "Curriculum Vitae Europass\nName" }).family).toBe("europass");
  expect(layoutFamily({ kind: "jpeg", text: "x" })).toEqual({ family: "scanner-or-photo", evidence: ["file type jpeg"] });
  expect(layoutFamily({ kind: "pdf", producer: "Skia/PDF m120", creator: "Google Docs Renderer", text: "x" }).family).toBe("google-docs");
  expect(layoutFamily({ kind: "docx", text: "x" }).family).toBe("other");
});

import { expect, test } from "vitest";
import { isLabel, tidyTitle } from "../src/modelReader";

// A CV that sets its titles in a table gave "| Service Delivery Manager / | SharePoint/Business Consultant / | Project Administrator" (owner, 10 Nov 2026),
// and a form gave "Institution:" as a qualification. Separators go and labels are not values; every word the CV wrote stays.
test("a title keeps its words and loses the table's dividing lines", () => {
  expect(tidyTitle("| Service Delivery Manager / | SharePoint/Business Consultant / | Project Administrator")).toBe("Service Delivery Manager / SharePoint/Business Consultant / Project Administrator");
  expect(tidyTitle("Data Analyst – ")).toBe("Data Analyst");
  expect(tidyTitle("FP&A Manager")).toBe("FP&A Manager");
  expect(tidyTitle("Finance Planning and Analysis Manager")).toBe("Finance Planning and Analysis Manager");
});
test("a form's label on its own is not a value", () => {
  expect(isLabel("Institution:")).toBe(true);
  expect(isLabel("Qualification Name:")).toBe(true);
  expect(isLabel("BCom Accounting")).toBe(false);
  expect(isLabel("Matric: 2010")).toBe(false);
});

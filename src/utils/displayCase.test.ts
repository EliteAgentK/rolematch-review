import { expect, test } from "vitest";
import { displayCase, employerName } from "./displayCase";

// Cases taken from how the 30 real CVs write their details in capitals (9 Nov 2026: 118 such details in 16 of the 30); the companies and titles are public names.
test("details written in capitals are shown in normal capitalisation, initialisms kept", () => {
  expect(displayCase("HEAD OF IT")).toBe("Head of IT");
  expect(displayCase("SENIOR MANAGER: SUPPLY CHAIN")).toBe("Senior Manager: Supply Chain");
  expect(displayCase("DISCOVERY HEALTH (PTY) LTD")).toBe("Discovery Health (Pty) Ltd");
  expect(displayCase("UNIVERSITY OF SOUTH AFRICA (UNISA)")).toBe("University of South Africa (Unisa)");
  expect(displayCase("FNB SOUTH AFRICA - JOHANNESBURG, SOUTH AFRICA")).toBe("FNB South Africa - Johannesburg, South Africa");
  expect(displayCase("CCI (CALL CENTERS INTERNATIONAL)")).toBe("CCI (Call Centers International)");
  expect(displayCase("DELOITTE AND TOUCHE SA, JHB – REMOTE")).toBe("Deloitte and Touche SA, JHB – Remote");
  expect(displayCase("BCOM - MANAGEMENT")).toBe("BCom - Management");
  expect(displayCase("VMWARE VSPHERE 6.5")).toBe("VMware vSphere 6.5");
  expect(displayCase("THE CRM TEAM")).toBe("The CRM Team");
  expect(displayCase("HOLLYWOOD BET")).toBe("Hollywood Bet");
  expect(displayCase("KPMG SERVICES")).toBe("KPMG Services");
  expect(displayCase("PL-900/MB210")).toBe("PL-900/MB210");
  expect(displayCase("ON SITE SUPERVISOR")).toBe("On Site Supervisor");
  // The AI's own written form comes first where it gave one.
  expect(displayCase("UNIVERSITY OF SOUTH AFRICA (UNISA)", { "UNIVERSITY OF SOUTH AFRICA (UNISA)": "University of South Africa (UNISA)" })).toBe("University of South Africa (UNISA)");
});

test("anything the CV wrote with small letters is shown exactly as written", () => {
  expect(displayCase("Head of IT at iOCO")).toBe("Head of IT at iOCO");
  expect(displayCase("BCom Accounting")).toBe("BCom Accounting");
  expect(displayCase("IT")).toBe("IT");   // too short to tell: left alone
  expect(displayCase("")).toBe("");
  expect(displayCase(undefined)).toBe("");
});

test("employers are shown without their legal ending", () => {
  expect(employerName("Discovery Health (Pty) Ltd")).toBe("Discovery Health");
  expect(employerName("DISCOVERY HEALTH (PTY) LTD")).toBe("Discovery Health");
  expect(employerName("NTT LTD")).toBe("NTT");
  expect(employerName("Interfront SOC Ltd")).toBe("Interfront");
  expect(employerName("Investec Bank Limited")).toBe("Investec Bank");
  expect(employerName("Bluespec Inc.")).toBe("Bluespec");
  expect(employerName("Smith Plumbing CC")).toBe("Smith Plumbing");
  expect(employerName("Absa Group (RF) (Pty) Ltd")).toBe("Absa Group");
  expect(employerName("Deloitte and Touche SA")).toBe("Deloitte and Touche SA");   // SA is South Africa
  expect(employerName("Ltd")).toBe("Ltd");   // nothing would be left
  expect(employerName("Standard Bank")).toBe("Standard Bank");
});

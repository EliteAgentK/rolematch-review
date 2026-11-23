// With STORE_DIR, the app's originals go to our own vault (docs/database/19_VAULT_V1.md), encrypted, through the same four calls the API and pipeline use.
import { randomBytes } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";

const root = mkdtempSync(join(tmpdir(), "store-dir-"));
process.env.STORE_DIR = root; process.env.VAULT_KEYS = `1:${randomBytes(32).toString("base64")}`;
const ORG = "6f1c2a9e-0b4d-4c7e-9a51-3d2e8f7b6a10", DOC = "c3b2a190-8f7e-4d6c-b5a4-938271605f4e";

test("the app's store calls use the vault: stored encrypted under its organisation, read back whole, and removed", async () => {
  const { putObject, getObject, deleteObjects } = await import("../src/supabase");
  const cv = new TextEncoder().encode("Thandi Mokoena, Financial Accountant");
  await putObject(`${ORG}/${DOC}`, cv, "application/pdf");
  expect(new TextDecoder().decode(await getObject(`${ORG}/${DOC}`))).toBe("Thandi Mokoena, Financial Accountant");
  const [file] = readdirSync(join(root, ORG));
  expect(readFileSync(join(root, ORG, file)).includes(Buffer.from("Thandi"))).toBe(false);
  await deleteObjects([`${ORG}/${DOC}`], { strict: true });
  await expect(getObject(`${ORG}/${DOC}`)).rejects.toThrow(/not in the vault/);
  await expect(getObject("../../etc/passwd")).rejects.toThrow(/not a vault path/);
});

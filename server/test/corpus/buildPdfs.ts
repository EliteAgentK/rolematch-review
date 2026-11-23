// Renders every corpus document to a real PDF with headless Chrome so the PDF reader is tested on genuine PDFs.
// Usage: node --import tsx test/corpus/buildPdfs.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CVS, JDS } from "../corpus";
import { spawnProc } from "../helpers";

const out = new URL("./pdf/", import.meta.url).pathname.replace(/%20/g, " ");
mkdirSync(out, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
for (const [id, text] of Object.entries({ ...Object.fromEntries(Object.entries(CVS).map(([k, v]) => [`cv-${k}`, v])), ...Object.fromEntries(Object.entries(JDS).map(([k, v]) => [`jd-${k}`, v])) })) {
  const html = join(tmpdir(), `${id}.html`);
  writeFileSync(html, `<html><body style="font-family:Helvetica;font-size:11pt;margin:40px">${text.split("\n").map((l) => `<p style="margin:3px 0">${esc(l)}</p>`).join("")}</body></html>`);
  const p = spawnProc([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${join(out, id + ".pdf")}`, `file://${html}`], { stdout: "ignore", stderr: "ignore" });
  await p.exited;
  console.log("built", id);
}

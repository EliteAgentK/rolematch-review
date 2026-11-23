// Makes a "scanned" CV: the page is turned into a picture and then wrapped in a PDF that has no text layer at all.
// Run: npm run build:scanned   (needs Google Chrome; the result is committed so tests do not need it)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnProc } from "../helpers";
import { CVS } from "./content";

const OUT = fileURLToPath(new URL("../../../sample-documents/cvs", import.meta.url));
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const cv = CVS.find((c) => c.id === "cv08-zanele-khumalo")!;
const body = cv.sections.map((s, i) => (i === 0 ? `<h1>${esc(s.lines[0])}</h1>${s.lines.slice(1).map((l) => `<p>${esc(l)}</p>`).join("")}` : `${s.h ? `<h3>${esc(s.h)}</h3>` : ""}${s.lines.map((l) => `<p>${esc(l)}</p>`).join("")}`)).join("");
const dir = join(tmpdir(), "th-scanned"); mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, "page.html"), `<html><style>body{font-family:Georgia,serif;font-size:15px;margin:40px;color:#222;width:700px}h1{margin:0}h3{margin:18px 0 4px;border-bottom:1px solid #999}p{margin:4px 0}</style><body>${body}</body></html>`);
const run = (args: string[]) => spawnProc([CHROME, "--headless=new", "--disable-gpu", `--user-data-dir=${join(dir, "profile")}`, ...args], { stdout: "ignore", stderr: "ignore" }).exited;
await run(["--hide-scrollbars", "--window-size=800,900", `--screenshot=${join(dir, "page.png")}`, `file://${join(dir, "page.html")}`]);
const png = readFileSync(join(dir, "page.png")).toString("base64");
writeFileSync(join(dir, "wrap.html"), `<html><style>@page{margin:0}body{margin:0}img{width:100%;display:block}</style><body><img src="data:image/png;base64,${png}"></body></html>`);
await run(["--no-pdf-header-footer", `--print-to-pdf=${join(OUT, "cv11-zanele-scanned.pdf")}`, `file://${join(dir, "wrap.html")}`]);
console.log("built cv11-zanele-scanned.pdf");

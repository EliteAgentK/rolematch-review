// Builds harder PDFs: a two-column CV and an image-only (scanned) CV.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnProc } from "../helpers";
const out = new URL("./pdf/", import.meta.url).pathname.replace(/%20/g, " ");
mkdirSync(out, { recursive: true });
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const render = async (id: string, html: string) => {
  const f = join(tmpdir(), `${id}.html`); writeFileSync(f, html);
  await spawnProc([CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${join(out, id + ".pdf")}`, `file://${f}`], { stdout: "ignore", stderr: "ignore" }).exited;
  console.log("built", id);
};
await render("cv-twocolumn", `<html><body style="font-family:Helvetica;font-size:11pt;margin:0"><div style="display:flex">
<div style="width:30%;background:#eee;padding:24px"><h1 style="font-size:18pt;margin:0">Ayesha Columns</h1><p>Contact</p><p>ayesha.columns@example.test</p><p>082 000 0000</p><p>Pretoria, South Africa</p><h3>Skills</h3><p>Python</p><p>Django</p><p>PostgreSQL</p><p>Docker</p><h3>Education</h3><p>BSc Computer Science</p><p>University of Pretoria</p><p>2014 - 2017</p></div>
<div style="width:70%;padding:24px"><h2>Profile</h2><p>Backend developer who builds reliable services.</p><h2>Experience</h2><p><b>Backend Developer</b></p><p>Orbit Systems | Feb 2020 - Present</p><p>Built Django REST services on PostgreSQL.</p><p>Containerised releases with Docker.</p><p><b>Junior Developer</b></p><p>Pixel Works | Jan 2018 - Jan 2020</p><p>Maintained Python scripts and reports.</p></div></div></body></html>`);
await render("cv-scanned", `<html><body style="margin:0"><img style="width:700px" src="data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="700" height="900"><rect width="700" height="900" fill="#fff"/><circle cx="350" cy="400" r="150" fill="#999"/></svg>')}"></body></html>`);

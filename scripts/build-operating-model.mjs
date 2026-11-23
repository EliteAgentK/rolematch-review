// Builds docs/product/OPERATING_MODEL.html (numbered step cards and figures) from OPERATING_MODEL.md, so the written model and the visual page can never disagree.
// Run from the repository root: node scripts/build-operating-model.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../docs/product/", import.meta.url));
const md = readFileSync(join(root, "OPERATING_MODEL.md"), "utf8").split("\n");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\*([^*]+)\*/g, "<em>$1</em>");

// ---- parse into sections of blocks
const sections = []; let cur = { title: "", blocks: [] }; let title = ""; const intro = [];
let i = 0;
while (i < md.length) {
  const line = md[i];
  if (line.startsWith("# ")) { title = line.slice(2); i++; continue; }
  if (line.startsWith("## ")) { cur = { title: line.slice(3), blocks: [] }; sections.push(cur); i++; continue; }
  if (!sections.length) { if (line.trim()) intro.push(line); i++; continue; }
  if (line.startsWith("|")) { const rows = []; while (i < md.length && md[i].startsWith("|")) { rows.push(md[i]); i++; } cur.blocks.push({ t: "table", rows }); continue; }
  const step = line.match(/^\*\*(S\d+)\. ([^*]+?)\.\*\*\s*(.*)$/);
  if (step) { const b = { t: "step", id: step[1], name: step[2], body: [step[3]].filter(Boolean), items: [] }; i++;
    while (i < md.length && md[i].trim() && !md[i].startsWith("**S") && !md[i].startsWith("## ")) { if (md[i].startsWith("* ")) b.items.push(md[i].slice(2)); else b.body.push(md[i]); i++; }
    cur.blocks.push(b); continue; }
  if (line.startsWith("* ")) { const items = []; while (i < md.length && md[i].startsWith("* ")) { items.push(md[i].slice(2)); i++; } cur.blocks.push({ t: "list", items }); continue; }
  if (line.trim()) { const p = []; while (i < md.length && md[i].trim() && !md[i].startsWith("* ") && !md[i].startsWith("## ") && !md[i].startsWith("|") && !md[i].startsWith("**S")) { p.push(md[i]); i++; } cur.blocks.push({ t: "p", text: p.join(" ") }); continue; }
  i++;
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const CHIP = /^(Where|Rule|Writes|Audit|Answer|Rule \(rate limits[^)]*\)|Refusals[^:]*):\s*(.*)$/s;

function renderItems(items) {
  const chips = [], plain = [];
  for (const it of items) { const m = it.match(/^(Where|Rule|Writes|Audit|Answer)(?: \([^)]*\))?:\s*(.*)$/s); if (m) chips.push(`<div class="chip ${m[1].toLowerCase()}"><span>${m[1]}</span><p>${inline(m[2])}</p></div>`); else plain.push(`<li>${inline(it)}</li>`); }
  return chips.join("") + (plain.length ? `<ul>${plain.join("")}</ul>` : "");
}
function renderTable(rows) {
  const cells = (r) => r.split("|").slice(1, -1).map((c) => c.trim());
  const head = cells(rows[0]), body = rows.slice(2).map(cells);
  return `<div class="tablewrap"><table><thead><tr>${head.map((h) => `<th>${inline(h)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

// ---- figures, placed after the section they explain
const figPipeline = `<figure class="fig"><figcaption>The stages a document goes through. Only a document that passes every stage becomes a record.</figcaption>
<div class="track"><div class="stage">received</div><i>›</i><div class="stage">security</div><i>›</i><div class="stage opt">optimising<small>large files only</small></div><i>›</i><div class="stage">reading</div><i>›</i><div class="stage">extracting</div><i>›</i><div class="stage">validating</div><i>›</i><div class="stage done">ready</div></div>
<div class="exits"><div class="exit"><b>Refused, final</b>file type, unreadable, copy-forbidden hold, photo or scan unreadable, no name, no title, too big. Shown to the person in plain words.</div><div class="exit"><b>Retried, then failed</b>timeouts and other faults: tried 3 times, then marked failed and left for an administrator to retry.</div><div class="exit ok"><b>Published</b>record, document link and audit entry in one transaction, or none of them.</div></div></figure>`;
const figEvidence = `<figure class="fig"><figcaption>How one requirement is judged. Credit is the share of that requirement's weight earned.</figcaption>
<div class="states"><div class="st verified"><b>verified</b><span>full credit</span><p>described work shows it</p></div><div class="st partial"><b>partially evidenced</b><span>half credit</span><p>listed or self-stated, not shown in described work</p></div><div class="st nd"><b>not demonstrated</b><span>no credit, not a failure</span><p>the CV does not show it; absence is not proof</p></div><div class="st contra"><b>contradicted</b><span>no credit; caps score at 40</span><p>defined, not yet produced by the checks</p></div><div class="st na"><b>not applicable</b><span>left out</span><p>does not apply to this job</p></div></div>
<div class="weights"><div><b>10</b>each mandatory requirement</div><div><b>4</b>each preferred requirement</div><div><b>4</b>location and arrangement</div></div>
<div class="weights conf"><div><b>50%</b>extraction quality</div><div><b>40%</b>evidence coverage</div><div><b>10%</b>job approved</div><div class="note">Confidence measures the evidence, never the candidate. Score bands: 90 and above exceptional, 80 strong, 65 plausible with gaps, 45 partial, below that limited documented evidence.</div></div></figure>`;
const figTenant = `<figure class="fig"><figcaption>Every request, in the order it is checked.</figcaption>
<div class="track small"><div class="stage">cross-site check</div><i>›</i><div class="stage">address limit</div><i>›</i><div class="stage">session and refresh</div><i>›</i><div class="stage">organisation and role</div><i>›</i><div class="stage">user limit</div><i>›</i><div class="stage done">route, scoped by organisation</div></div></figure>`;
const FIGS = { "4. Upload": null, "2. Log in, stay logged in, log out": figTenant, "6. Reading: from file to record (the pipeline)": figPipeline, "8. Matching": figEvidence };

// ---- overview chain
const phases = sections.filter((s) => /^\d+\./.test(s.title) && !/^1[0-2]\./.test(s.title));
const range = (s) => { const ids = s.blocks.filter((b) => b.t === "step").map((b) => b.id); return ids.length ? (ids.length > 1 ? `${ids[0]}–${ids[ids.length - 1]}` : ids[0]) : ""; };
const overview = phases.map((s) => `<a class="phase" href="#${slug(s.title)}"><b>${esc(s.title.replace(/^\d+\.\s*/, ""))}</b><small>${range(s)}</small></a>`).join("<i>›</i>");

// ---- body
let body = "";
for (const s of sections) {
  body += `<section id="${slug(s.title)}"><h2>${esc(s.title)}</h2>`;
  for (const b of s.blocks) {
    if (b.t === "table") body += renderTable(b.rows);
    else if (b.t === "p") body += `<p>${inline(b.text)}</p>`;
    else if (b.t === "list") body += `<ul class="plain">${b.items.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>`;
    else if (b.t === "step") body += `<article class="step" id="${b.id}"><div class="badge">${b.id}</div><div class="card"><h3>${esc(b.name)}</h3>${b.body.map((p) => `<p>${inline(p)}</p>`).join("")}${renderItems(b.items)}</div></article>`;
  }
  if (FIGS[s.title]) body += FIGS[s.title];
  body += `</section>`;
}

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>RoleMatch operating model</title>
<style>
:root{--bg:#fff;--fg:#1c1b19;--mute:#5d5b55;--card:#f6f5f1;--line:#dcdad2;--acc:#1f6f5c;--accbg:#e3f1ed;--warn:#8a5a00;--warnbg:#fbf0d9;--code:#ece9e1}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#171716;--fg:#ecebe6;--mute:#a7a59d;--card:#22221f;--line:#3a3935;--acc:#74c7b0;--accbg:#1e3b34;--warn:#e6b45a;--warnbg:#3b2f17;--code:#2c2b27}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif}
main{max-width:980px;margin:0 auto;padding:24px 16px 80px}h1{font-size:28px;margin:8px 0}h2{font-size:22px;margin:48px 0 12px;padding-top:8px;border-top:1px solid var(--line)}h3{font-size:17px;margin:0 0 6px}
code{background:var(--code);padding:1px 5px;border-radius:4px;font-size:.9em}p{margin:6px 0}small{color:var(--mute)}
.lede{color:var(--mute);max-width:760px}.overview{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:20px 0}.overview i{color:var(--mute);font-style:normal}
.phase{display:block;background:var(--accbg);color:var(--fg);border:1px solid var(--acc);border-radius:10px;padding:8px 12px;text-decoration:none;min-width:120px}.phase b{display:block;font-size:14px;font-weight:600}.phase small{font-size:12px}
.step{display:grid;grid-template-columns:56px 1fr;gap:12px;position:relative;padding-bottom:14px}.step:not(:last-of-type)::before{content:"";position:absolute;left:27px;top:44px;bottom:-4px;width:2px;background:var(--line)}
.badge{width:54px;height:36px;border-radius:18px;background:var(--acc);color:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;z-index:1}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:12px 16px}
.chip{display:grid;grid-template-columns:70px 1fr;gap:8px;margin:6px 0;padding:6px 10px;border-radius:8px;background:var(--bg);border:1px solid var(--line)}.chip span{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--mute);padding-top:2px}.chip p{margin:0}
.chip.rule{border-left:4px solid var(--acc)}.chip.writes{border-left:4px solid #6a7fd1}.chip.audit{border-left:4px solid #b9803a}.chip.where{border-left:4px solid #8a8a80}.chip.answer{border-left:4px solid #3aa37a}
ul{margin:6px 0 4px 18px;padding:0}li{margin:3px 0}ul.plain{margin-left:20px}
.tablewrap{overflow-x:auto;margin:10px 0}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{color:var(--mute);font-weight:600}
.fig{margin:16px 0 8px 68px;padding:14px;border:1px dashed var(--line);border-radius:12px}figcaption{font-size:14px;color:var(--mute);margin-bottom:10px}
.track{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.track i{color:var(--mute);font-style:normal}.stage{padding:8px 12px;border-radius:8px;background:var(--card);border:1px solid var(--line);font-size:14px}.stage.opt{border-style:dashed}.stage.done{background:var(--accbg);border-color:var(--acc)}.stage small{display:block;font-size:11px}
.exits{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px}.exit{padding:10px 12px;border-radius:10px;background:var(--warnbg);color:var(--fg);font-size:14px}.exit b{display:block;color:var(--warn)}.exit.ok{background:var(--accbg)}.exit.ok b{color:var(--acc)}
.states{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.st{padding:10px;border-radius:10px;background:var(--card);border:1px solid var(--line);font-size:13px}.st b{display:block;font-size:14px}.st span{display:block;color:var(--acc);font-weight:600;margin:2px 0}.st p{margin:0;color:var(--mute)}.st.contra span{color:var(--warn)}
.weights{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}.weights div{padding:8px 12px;border-radius:10px;background:var(--card);border:1px solid var(--line);font-size:13px}.weights b{display:block;font-size:20px;color:var(--acc)}.weights .note{flex:1 1 100%;background:none;border:none;color:var(--mute);padding:0}
@media (max-width:640px){.step{grid-template-columns:44px 1fr}.badge{width:42px;font-size:12px}.fig{margin-left:0}.step:not(:last-of-type)::before{left:21px}.chip{grid-template-columns:1fr}}
</style></head><body><main>
<h1>${esc(title)}</h1>
<p class="lede">${intro.map(inline).join(" ")}</p>
<div class="overview" aria-label="The journey, in order">${overview}</div>
${body}
</main></body></html>`;
writeFileSync(join(root, "OPERATING_MODEL.html"), html);
console.log("wrote OPERATING_MODEL.html,", html.length, "bytes,", (html.match(/class="step"/g) ?? []).length, "steps");

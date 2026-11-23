// Every document in the manifest through the production reading path (src/prepare.ts, the service's own), one process per shard. Each gets an outcome by stable ID: published, review required, refused or failed, with its reason. Resumes where it stopped. No database and no model: this measures reading.
//   node --import tsx test/collection/run.ts <root> <manifest> <out dir> <shard> <shards> [--real]
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stopOcr } from "../../src/ocr";
import { prepareDocument } from "../../src/prepare";
import { defaultSettings } from "../../src/settings";
import { PARSER_VERSION } from "../../src/version";

const [root, manifest, out, shardArg, shardsArg] = process.argv.slice(2), shard = Number(shardArg), shards = Number(shardsArg), REAL = process.argv.includes("--real");
mkdirSync(out, { recursive: true });
const file = join(out, `outcomes-${shard}.jsonl`), done = new Set(existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l).id) : []);
const org = defaultSettings(), asOf = new Date("2026-11-05T00:00:00Z"), LIMIT_S = 240;
// Files over what an organisation allows never reach the reader in the service: the upload is refused. That is an outcome too.
const maxBytes = org.limits.maxFileMb * 1048576;
const rows = readFileSync(manifest, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((r) => !r.duplicateOf && r.real === REAL).filter((_, i) => i % shards === shard);
const within = <T,>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => setTimeout(() => no(new Error(`TIMEOUT over ${LIMIT_S} s`)), LIMIT_S * 1000))]);
for (const r of rows) {
  if (done.has(r.id)) continue;
  const t0 = performance.now(), row: any = { id: r.id, family: r.family, stem: r.stem, collection: r.collection, kind: r.kind, format: r.format, parser: PARSER_VERSION };
  try {
    if (r.bytes > maxBytes) { Object.assign(row, { outcome: "refused", code: "FILE_TOO_BIG", reason: "over the organisation's upload limit" }); }
    else {
      const o: any = await within(prepareDocument(new Uint8Array(readFileSync(join(root, r.path ?? r.realPath))), { kind: r.kind, org, asOf }));
      if (o.ok) Object.assign(row, { outcome: o.review?.state === "needs_review" ? "review" : "published", review: o.review?.reasons ?? [], confidence: o.confidence, reader: o.meta?.reader, order: o.meta?.readingOrder, viaOcr: !!o.meta?.viaOcr, record: o.record, text: REAL ? undefined : o.text, chars: o.text?.length ?? 0 });
      else Object.assign(row, { outcome: "refused", code: o.code, stage: o.stage, reason: REAL ? undefined : o.message });
    }
  } catch (e) { Object.assign(row, { outcome: "failed", code: "CRASH", reason: String((e as Error).message).slice(0, 200) }); }
  row.ms = Math.round(performance.now() - t0);
  appendFileSync(file, JSON.stringify(row) + "\n");
}
await stopOcr().catch(() => {});
console.log(`shard ${shard}: ${rows.length} done`);
process.exit(0);

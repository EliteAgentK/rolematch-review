// Builds src/docmodel/ordinaryWords.txt from the system's word list (Webster's Second, 1934, out of copyright), without the words that list itself gives as proper names.
// No CV goes into it. After rebuilding, put the printed hash in extractionConfig.evidence.ordinaryWordsSha, so a changed list changes the configuration's fingerprint.
// Usage: node --import tsx test/proto/buildOrdinaryWords.ts
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const names = new Set(readFileSync("/usr/share/dict/propernames", "utf8").toLowerCase().split("\n"));
const words = [...new Set(readFileSync("/usr/share/dict/web2", "utf8").split("\n").filter((w) => /^[a-z]{2,12}$/.test(w) && !names.has(w)))].sort();
const text = words.join("\n") + "\n";
writeFileSync(join(import.meta.dirname, "..", "..", "src", "docmodel", "ordinaryWords.txt"), text);
console.log("words", words.length, "sha", createHash("sha256").update(text).digest("hex").slice(0, 16));

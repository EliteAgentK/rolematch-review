# ADR-001: The custom database and matching blueprint (review and decision)

Status: proposed, 2026-10-22. Input: the "Master Architectural Blueprint: Custom HR DBMS and Matching Engine" supplied by the owner.

## What the blueprint is trying to achieve

Data ownership, no licence fees, no dependence on a vendor that can have an outage, a 99.99% SLA, corporate audit readiness, a matching engine that is deterministic and explainable, and local models only. Those goals are right and are ours. This record separates the **goals** (keep all of them) from the **method** (a database engine written from scratch), which is the part that should change.

## Decision

1. **Do not write a database engine from scratch.** Run **PostgreSQL on infrastructure we own** (open, permissive licence, zero fees), made highly available, with `pgvector` for similarity search. This meets every goal above without taking on a multi-year engine project whose failure mode is silent data loss.
2. **Keep the existing matching engine as the authority.** Its rules are frozen, versioned and evidence-based (`server/src/ruleset.ts`). Local embeddings may be added as a *supporting, displayed signal* with its own explanation; they do not silently replace or reweight the frozen formula.
3. **No outside AI service, ever.** Part 6 of the blueprint sends the score payload to Claude. That breaks the owner rule. Any written explanation must come from a local model, or be templated from the evidence (which is what the match panel already does).
4. Take the good ideas from the blueprint that fit (section "What we adopt").

## Why not build the engine

* **Risk is asymmetric.** A database that loses or corrupts one customer's records once is an extinction event for a corporate product. PostgreSQL has about 30 years and thousands of production-years of exposure to exactly the failures the blueprint lists (torn pages, fsync semantics, recovery bugs, transaction id wraparound). A new engine starts with none, and ARIES recovery, MVCC with vacuum, Raft with fencing and a buffer manager are each, on their own, long projects whose bugs appear only under crashes.
* **The SLA argument inverts.** 99.99% is about 52 minutes of downtime a year. A new storage engine is the least likely thing to meet it. A well-run three-node PostgreSQL cluster (Patroni with etcd, synchronous replication, a floating address or a proxy, automatic failover) is routinely run at that level.
* **Audits favour boring.** Corporate security reviewers ask for known, patched, widely audited components with a CVE process. A bespoke engine has no external audit history; every review would start from zero.
* **Cost.** Estimated honestly, the engine alone is multiple engineer-years before any recruiter feature gets faster. The same effort spent on the product is worth more.
* **"Zero licensing" is already met.** PostgreSQL's licence is permissive, so are `pgvector`, Patroni (MIT), etcd (Apache-2.0) and PgBouncer. Self-hosting removes the vendor dependency the owner objects to.

## If a from-scratch engine is still wanted: language

**Rust.** No garbage collector (Go's pauses and allocation behaviour hurt a buffer pool and a hot scoring loop), memory safety in a codebase that parses untrusted binary pages and network input (C++ makes use-after-free and buffer overruns easy and they are exactly the class of bug an audit hunts), real control of layout (`repr(C)`, alignment), good SIMD support, and a mature ONNX Runtime binding (`ort`). It should be a separate research project off the critical path, never the system of record.

## Traps in the blueprint to fix before any code (applies to any implementation)

### Slotted pages
* A 1536-dimension `f32` vector is **6144 bytes**: one per 8 KB page, and it cannot share a page with a long resume. A CV of 30 KB or more does not fit a page at all. You need **overflow pages** (as PostgreSQL's TOAST) or the vectors in a separate, aligned column store.
* **Alignment.** Rows grow upward from the bottom of the page, so the offset of a vector depends on the length of the rows above it. Pad each vector to the alignment its consumer needs (4 bytes for `f32`, 32 for AVX2 loads without line-crossing, 64 for AVX-512) and define the on-disk layout explicitly, little-endian, never by casting in-memory structs.
* **32-bit slot offsets are wasteful** in an 8 KB page (13 bits address every byte). PostgreSQL packs offset, length and flags into 4 bytes.
* **Torn pages.** A page write is not atomic on 4 KB-sector disks. Without per-page checksums and full-page images in the log after a checkpoint, recovery can read garbage that looks valid.
* **ARIES needs a log sequence number on every page** (so redo is idempotent), compensation records for undo, and fuzzy checkpoints. "Redo then undo" alone is not enough.
* **`fsync` is subtle:** it must also sync the directory on file creation or rename; macOS needs `F_FULLFSYNC`; a failed `fsync` must be treated as fatal (the kernel may drop the dirty pages).
* **MVCC without vacuum is a leak.** `xmin` and `xmax` need a cleaner, and a 32-bit transaction id wraps; you need freezing.

### The 4-pillar formula
* **`S_req` is not Jaccard.** Jaccard divides by the union; the formula divides by `|R_job|`, which is coverage (recall). Say which is meant.
* **`S_density` is unbounded**, so it cannot be added to three values in [0, 1] with weights. It also rewards **repeating a word**, so a candidate can raise the score by stuffing keywords. And `ln(N / Freq)` is undefined when `Freq = 0` and negative if `Freq > N`.
* **`S_semantic` as written** sums dot products over sections but divides by one pair of norms; that is not a cosine. It must be a cosine per section, then a weighted combination. A zero vector divides by zero (NaN).
* **Floating-point determinism.** AVX2 and AVX-512 sum in different orders, so the same two vectors can differ in the last digits on different machines, and ONNX outputs can differ by runtime and hardware. Scores must be **reproducible for an audit**: fix the accumulation order, or quantise (for example, fixed-point after a stated rounding) and version the model and runtime.
* **Dimension mismatch.** BGE-large is 1024-dimensional and MiniLM is 384; "1536" is another provider's size. Decide the model, then the dimension.
* **Linear scan versus HNSW.** Part 4 says linear scan; Part 7 rebuilds an HNSW index. They have different recall and determinism. Exact scan is deterministic and fine up to a few hundred thousand vectors; approximate search must be labelled as such.
* **`S_tenure` infers seniority from titles** (`alpha` for Junior to Senior to Lead). That is a proxy that can encode bias (age, gaps for caregiving) and is exactly what POPIA section 71 and the equity rules make sensitive. Keep it as displayed facts (dated roles), not a hidden multiplier.
* **The kill switch `Q = 0` treats absence as proof of failure.** A CV that does not mention a degree is not evidence the person lacks one. Our rules say so explicitly (not demonstrated is never a failure), and a binary automatic rejection is the kind of decision POPIA section 71 restricts. The platform recommends for human review; it never silently rejects.
* **A single composite number invites false precision.** The match panel shows evidence per requirement, strengths, gaps and confidence; a composite hides that.

### Ingestion
* **A vision model does not give "without dropping words".** Vision-language models paraphrase and invent. Our rule is that every extracted value must appear in the document (a quote or a position). Use a model to *propose*, and keep the evidence check as the gate.
* **Typo "correction" (Pyth0n to Python) invents facts** unless the document itself supports it; we repair only where the page supports the repair.

### Compliance
* **"Overwrite the page" is not erasure.** The data also lives in the log, replicas, backups, filesystem and SSD wear-levelled blocks. The reliable technique is **crypto-shredding**: encrypt each tenant's (or person's) data with its own key and delete the key. We already delete records, matches and originals and scrub audit detail; per-tenant keys would complete it.
* **Audit before reading returns** makes every read a durable write; budget for it, batch it, and chain entries by hash so tampering shows.
* **STONITH** needs a fencing token that the storage layer enforces (the old primary is refused by the *data*, not just asked to stop), otherwise a slow node can still write after a partition.

## What we adopt from the blueprint

* Three-node cluster with automatic failover, a single address for the application (Patroni, etcd, a proxy or VRRP), and fencing.
* Per-tenant isolation enforced at the lowest layer (PostgreSQL Row Level Security as a second line behind the API).
* An independent, append-only, hash-chained audit ledger, and per-tenant keys for erasure.
* Model version tracking on every vector and a background re-embedding job.
* Search modes one-to-many and one-to-one, with the target vector read once.
* The principle that **a model never computes the score** and that the explanation is generated from recorded evidence.

## Build order that follows from this

1. Own-infrastructure PostgreSQL, three nodes, automatic failover, backups and point-in-time recovery, migration off the dev project. (Hardware or hosting is the owner's call.)
2. Hash-chained audit ledger and per-tenant encryption keys.
3. Local embeddings with `pgvector` as a supporting similarity signal, shadow-measured against recruiter judgement, with the model version recorded.
4. Batch uploads and the review workflow at scale.

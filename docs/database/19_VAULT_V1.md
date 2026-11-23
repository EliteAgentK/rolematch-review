# File vault, first slice: our own encrypted store for originals, and the copy from Supabase

Written 8 November 2026, before any code (owner rule: plan with diagrams first). It builds the first part of [06_FILE_VAULT.md](06_FILE_VAULT.md) and phase 2 of [13_PLAN.md](13_PLAN.md). Live keeps using Supabase's private bucket until the cutover; nothing here changes live.

## Where it starts

Every original is stored through four functions in `server/src/supabase.ts` (`putObject`, `getObject`, `deleteObjects`, and `signedUrl`, which nothing calls). Paths are `<organisation id>/<document id>`: random, no names. A local fallback (`STORE_DIR`) exists for test benches, but it writes **plain, unencrypted** files, not atomically, and keeps the path as the file name. It is not fit to hold real CVs, and it is replaced, not kept beside the vault (owner, 27 Oct: remove what is unused).

**Beside it today:** `originalsCopy.ts` keeps an encrypted copy of every original on the PC (one flat folder, the same key as the held uploads, no path binding), refreshed by each backup, because Supabase is the primary store and can be unreachable. Once the vault is the primary store, that copy has no job left: it retires at the cutover, and the vault's own backup to the Mac takes its place. Until then they do different jobs and neither replaces the other.

## How it fits

```
 upload ─► API ─► putObject(path, bytes) ─┬─► (live today) Supabase private bucket, Ireland
                                           └─► (STORE_DIR set) vault on the PC
                                                  │
     vault/<organisation id>/<sha256(path)>.bin   │  one folder per organisation: a tenant's files can be listed and erased together
     file = "RMV1" │ key version (1 byte) │ nonce (12) │ tag (16) │ AES-256-GCM ciphertext
     associated data = "rolematch-vault|" + path  ──►  a file copied to another path, or another tenant's folder, fails its tag
     write: temp file in the same folder ─► fsync ─► rename ─► fsync folder   (a crash leaves the old file or the new one, never half)
     keys:  VAULT_KEYS="1:<base64>,2:<base64>" in the PC's root-only settings file, never on the vault's disk or in the database;
            new files use the highest version, old ones keep reading with theirs (rotation without rewriting everything at once)

 rehearsal copy (read-only on live):
   documents.storage_path ──► download from Supabase ──► put into a rehearsal vault ──► read back, decrypt ──► same SHA-256 as downloaded
                                                                                     └► and as documents.sha256 when the original was never replaced
   prints counts only: copied, verified, differing from the recorded hash (with why), missing at the source
```

## Rules carried into the code

1. **Nothing readable on disk:** every object is encrypted; a missing key refuses to start the vault rather than writing plain files.
2. **A file belongs to its path:** the path is bound into the encryption, so swapping files between documents or tenants is detected, not served.
3. **No half files:** atomic rename after fsync; a reader never sees a partial object.
4. **Names never on disk:** the file name is a hash of the path; the folder is the organisation's id, which is not personal.
5. **No climbing out:** a path must be `<id>/<id>` of letters, digits, dots, dashes and underscores; anything else is refused.
6. **Tampering is loud:** a file that fails its tag is never returned; the error says so and names no content.
7. **Same contract as today:** callers do not change; `putObject` still overwrites a path (the pipeline replaces an oversized image with its smaller form), and the bounded queue in front of the store stays.

## Tests (written with the code)

- Round trip; a file moved to another path or organisation fails; a flipped byte fails; a wrong key fails.
- Rotation: a file written under key 1 reads after key 2 is added and becomes current; new files use key 2.
- Paths with `..`, absolute paths, empty segments or other characters are refused.
- No temporary file is left after a write, and twenty overlapping writes leave one whole file. **Honest limit:** a test cannot show a half-written file, because small writes look whole either way; switching the rename for a plain write still passes. The guarantee comes from how the write is built (temporary file, flush, rename, flush folder), not from a test.
- No key: the vault refuses to start.
- The copy script on a fake source: counts copied, verified, differing and missing; never prints a path's contents.

## Not in this slice

The database side of 06 (version rows, tombstones before purge, reconciler for abandoned temporary files, sampled re-verification, signed short-lived links). The API streams every original itself and audits each view, so no signed link is needed yet. Backups of the vault join the database's continuous backup at the cutover.

## Result, 8 Nov 2026 (01:05)

* **Tests:** 9 vault and copy tests, plus the app's store calls through the vault (`store-dir.test.ts`). Turning off the path binding makes the swap test fail, as it should. Turning the rename into a plain write does not, which is the honest limit noted above.
* **The plain-file `STORE_DIR` store is removed.** `STORE_DIR` now means the vault, and without `VAULT_KEYS` the API refuses to start.
* **Rehearsal copy from live, on the PC:** live's 5 originals listed, 5 copied, 5 read back and decrypted to the downloaded bytes, 0 differing from the hash recorded at upload, 0 missing, 0 failed. Live's bucket was only read, 3 at a time. The rehearsal vault is `/srv/rehearsal/vault` (2 organisation folders, root's and the app user's only), under its own key in `/etc/rolematch/vault-rehearsal.env` (root only). It is not the live vault: at the cutover the copy runs again with the live key.

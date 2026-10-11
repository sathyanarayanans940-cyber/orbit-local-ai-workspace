# Document recovery and efficiency audit — 2026-10-09

## Changes

- Preserve bounded, recognized legacy file recipes when current export validation rejects them. The chat card offers Repair file; it does not display the invalid source. Repair validates the replacement and generates its binary before saving it. Original IDs, revision metadata and identical duplicate cards are retained. Failed storage, cancellation and chat changes preserve the original. Existing schema and mathematical-text export guards remain in effect.
- Keep long-document checkpoints, including the completed normalized recipe, until every export succeeds and the chat save completes. Reloading and retrying a finished draft reuses it without another drafting call. Partial, failed and cancelled exports do not release the checkpoint.
- Separate document section count from page count. Model-selected sections receive unequal word allocations; formatting and page geometry inform an estimated capacity. Maximum page requests need not be padded. Explicit word counts are not silently capped. PPT retains its requested slide count. Page estimates are not measured Word pagination.
- Let the outline assign source bodies to individual sections while retaining human instructions. Each section receives a source catalogue and can request the full body of another source. Unknown IDs and repeated requests terminate with bounded validation errors. Omitting selections retains the previous full-context behavior.
- Improve the existing 16-item / 32 MiB binary cache with read-based LRU ordering and oversized-entry bypass. Correction to the initial audit: the byte cap already existed; this change does not introduce it.
- Preserve invalid archive filenames in the Files index without aborting chat persistence. Viewer recovery rejects flagged legacy recipes before consulting cached binaries.

## Validation

`npm test`: **821 passed, 0 failed**. Twelve new tests cover:

1. Legacy recipe preservation across repeated normalization, with repair markup and no raw equation source.
2. Real DOCX export after repair, inspected through its ZIP/XML content.
3. Failed validation, failed storage, abort and chat-switch rollback.
4. LRU reads, byte accounting, replacement and oversized bypass.
5. Formatting-dependent capacity and unequal section allocation independent of page count.
6. Selected full source bodies, verbatim instructions and lossless source expansion.
7. Completed draft retention and retry after an IndexedDB reload, without more model calls.
8. Checkpoint release gated by complete exports and successful persistence.
9. Repair of duplicate cards without overwriting distinct revisions.
10. Invalid nested recipes surviving chat migration and actual IndexedDB writes.
11. Viewer refusal of a flagged recipe even with cached old bytes.
12. Bounded repeated/unknown source requests and uncapped explicit word-count accounting.

Existing export, mathematics, chat, context, widget and integration regressions also pass. Assets bumped to shell v334, app v262, viewer v26, widget UI v45, long-document builder v19, chat store v7 and boot v72.

## Limits

These are deterministic CLI and simulated DOM/storage checks; no live-provider or interactive browser test was performed in this pass. Model semantic faithfulness and exact document pagination are not guaranteed by schema validation. Source selection reduces repeated payload when the model supplies useful selections; no live latency improvement is claimed. Repair attempts remain bounded and can report failure while keeping the original recipe. Local installed Orbit still needs its web-only updater and a reload. The friend distribution is rebuilt separately by the allowlisted release script.

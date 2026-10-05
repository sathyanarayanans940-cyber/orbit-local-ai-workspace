# Orbit workspace tools — 4 October 2026

The workspace features below are implemented. Answer depth and in-chat search were removed on request. Cmd/Ctrl+F uses browser search. The installed app receives them
when the updater is run and Orbit is reloaded.

| Feature | Where to find it | Behavior |
|---|---|---|
| PDF citations | Source-page chips in replies | Opens the original uploaded PDF at the cited page; unknown source/page markers never become links. Requires extracted page text and model-provided citations. |
| Document versions | Version history below an edited file | Keeps up to 20 previous versions. Compare text, preview/download originals, or restore as a new revision. Old backups without an editable snapshot remain previewable. |
| Conversation branches | Branch icon below any completed message | Copies the conversation through that message. Original chat remains intact and document IDs are isolated. The new chat shows an origin banner with a link back. |
| Bookmarks | Bookmark icon below a prompt or reply; Chat tools → Bookmarks | Saves the whole message or a selected passage; jump back from the bookmark list. |
| Study mode | Chat tools → Study mode | Quizzes or flashcards from the current chat or a selected readable upload/image. Answers reveal on demand; quiz scoring is a self-check. Written attempts and revealed answers survive navigation within the open study set. |
| Model comparison | Chat tools → Compare two models | Sends only after Run; separate replies, cancellation and failures. No fallback. Add the chosen answer to chat or copy it. |
| API controls | Chat tools → API limits and budget | Daily request ceiling, per-request output cap, reported-token and estimated-cost thresholds, 80% alerts and optional approval per model. |
| Code diff | Compare code beneath code replies | Choose old/new blocks and inspect additions/removals. Full source remains in the reply. |
| Prompt shortcuts | Type `/`; Chat tools → Prompt shortcuts | Insert, create, edit or remove prompts. Insertion never sends automatically. |
| Progress and recovery | Chat tools → Response progress; retry controls | Observed stages, retained partial attempts and file recipes, session reuse of completed preparation for unchanged retries. Existing long-document checkpoints remain supported. |
| ZIP archives | Upload a `.zip`, or explicitly request a ZIP download | Inventories folders and reads supported documents, images, notebooks, text and source code. The viewer browses folders and opens members in separate persistent tabs. ZIP downloads can contain new file recipes and original uploaded/generated files. |
| Jupyter notebooks | Explicitly request an `.ipynb` / Jupyter notebook; More → Widgets → Jupyter notebooks | Generates validated Markdown, code and raw cells with kernel metadata. Download, preview or include in ZIP folders. Code starts unexecuted, with no saved results. |

Chat tools also contains Archive/Unarchive, Export and Delete for saved conversations. The separate three-dot menu is removed. Delete still asks for confirmation.

## Limits and storage

API controls cover this browser's Orbit requests, including internal work. They
are not provider account billing limits. Other browsers/devices are outside the
scope. Request admission uses an atomic IndexedDB counter across tabs. Failed
attempts count. Limits reset at local midnight. Local Ollama inference is excluded.

Token/cost thresholds use provider-reported totals. Missing reports, unpriced
models, fees and cached-token pricing can make estimates incomplete. Already
running requests may exceed thresholds. Prices are user-entered in one currency;
Orbit does not invent current prices. Output caps can truncate long responses.

Chat bookmarks, branches and document revisions persist in the chat library;
shortcuts persist in this browser. Study and comparison
panels are temporary unless an answer is explicitly added to chat. Preparation
recovery is bounded to two recent contexts for 30 minutes in the same tab session;
changed model, thinking, web or memory settings invalidate reuse. It stores no
private model reasoning. Text comparisons do not compare layout or images.

Code still appears in code blocks by default. None of these controls implicitly
authorize generating code files, modifying uploaded originals or switching models.

## ZIP files

Uploaded ZIPs use the existing readers for PDF, DOCX, PPTX, XLS/XLSX, images,
notebooks, text and code. Unsupported binaries remain listed with a notice.
File paths identify extracted content in the model's attachment context. Files
remain inert; Orbit does not execute source files or write archive paths to disk.
The viewer's ZIP tab and selected folder survive website reloads; files load on
demand after reload. Switching between mounted viewer tabs reuses their views.

Ask explicitly for a ZIP, for example “Return a ZIP with src/main.cpp and a PDF
report under docs/” or “Package these uploaded files into a ZIP.” Existing source
files keep their bytes and extensions. Missing source files fail visibly rather
than being silently replaced. Fresh binary documents use the actual document
exporters. ZIP generation is available across providers and follows the current
message's request; reading a ZIP or saying “continue” does not authorize a new
ZIP or standalone code download. Normal code replies stay in fenced code blocks.

Supported archives use standard Store or Deflate compression. Limits: 25 MB ZIP,
16 MB per expanded file, 64 MB total expanded content, 500 entries (including
folders), and 100,000 extracted text characters. Nested archives share the reading
budget and are read through two nested ZIP levels. Generated recipes allow up to
100 declared entries and count automatically created parent folders toward 500.
Truncation, unreadable entries and unsupported binaries are identified explicitly.
Password-protected, multipart and ZIP64 archives, symbolic links, unsafe paths
and duplicate/conflicting paths are rejected. Generated nested ZIP recipes are
not supported; use folders or package an already uploaded ZIP instead.

## Jupyter notebooks

Ask for a notebook explicitly, for example “Create a Python `.ipynb` notebook
with Markdown explanations and code cells.” The current message must request
the file; earlier requests, uploaded instructions and ordinary code follow-ups
do not authorize a notebook download. A following “show the code” reply stays
in code blocks. An explicit ZIP request can include notebooks inside its folders.

The shared exporter supports notebook format 4.5, unique stable cell IDs,
Markdown/code/raw cells, source strings or arrays, cell tags, and Python 3 or
specified kernel metadata. It preserves indentation, newlines, Unicode and
literal backslashes. Limits are 200 cells, 100,000 source characters per cell
and 400,000 total. Blank notebooks and empty cells are valid. Invalid cells,
unsafe filenames, fabricated saved outputs and embedded cell attachments are
rejected. Code cells have `execution_count: null` and empty `outputs`.

Generated notebooks use the existing read-only viewer and persistent tabs;
switching mounted tabs reuses the preview, and reload reconstructs it on demand.
The preview displays cell source as inert text. Orbit does not execute cells or
install kernels. Download and open the file in Jupyter or Colab to run it.
Existing uploaded notebooks can still be read and packaged unchanged into ZIPs.

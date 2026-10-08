# Orbit local AI workspace

Personal software project: a **local AI workspace for LM Studio and Ollama**, with optional **Google Gemini, DeepSeek and OpenAI API integrations**. Built with JavaScript, Python provider adapters, IndexedDB and offline document libraries for file uploads, previews and document generation.

**Status:** actively developed prototype. Features and regression tests are included; this portfolio snapshot does not establish production readiness or reliable output from every model. Generated content depends on the selected model.

## Latest update — 8 October 2026

Model-directed tool selection avoids mandatory web/Analyze planning for ordinary replies. Selected independent tool work can run concurrently; document generation retains complete tool schemas and requested detail. This update also includes automatic output-limit continuation, Word formatting controls and reference-style extraction, PowerPoint image handling fixes, and stronger widget recovery and context retention.

Fresh regression coverage includes cancellation, malformed and mixed recipes, output limits, ZIP exports, notebooks, source files and document follow-ups. Models can still fail to provide a valid recipe; recovery is bounded and reports failure rather than fabricating a substitute document.

## What to inspect

- `app.js`, `chat-store.js`, `memories.js`: conversations, persistence and scoped memory.
- `server.py`, provider adapters: local HTTPS server and provider requests.
- `widgets-engine.js`, `widgets-ui.js`, `workspace-tools.js`: structured document recipes, previews and downloads.
- `tests/`: automated source tests. Vendor license notices are retained under `vendor/`.

This snapshot focuses on the local application and retains the experimental `cloud/` source for its related tests. Generated audit outputs are omitted. Local certificates, private keys, credentials and chat data are not included.

## Features

A self-contained local AI chat workspace UI inspired by ChatGPT and Open WebUI. It includes:

- Local model discovery for LM Studio (`127.0.0.1:1234`) and Ollama (`127.0.0.1:11434`)
- Responsive conversation history sidebar
- Light, dark, and system appearance modes
- Model-aware chat requests for both local APIs
- Optional Google Gemini, DeepSeek and OpenAI API integrations through Python provider adapters
- A ChatGPT-style plus menu for model selection and file uploads
- File picker and drag-and-drop attachments on the message composer
- Image attachments are sent as multimodal payloads to vision-capable local models
- PDF, DOCX, PPTX, and text/code files are extracted locally and included in model prompts
- Runtime discovery retries automatically when Ollama or LM Studio is temporarily unavailable
- Markdown-style responses with labeled code blocks and copy buttons
- Offline KaTeX math rendering with bundled fonts and no CDN dependency
- Demo mode when neither local runtime is running
- Built-in offline PDF, DOCX, PPTX and XLSX generation with previews and downloadable chat attachments
- 21 SVG chart types and SVG diagrams, with compatible chart-type switching, table views and downloads

## Widgets and generated files

Open **More → Widgets** in the sidebar to enable or disable PDF, Word, PowerPoint, Excel,
charts, diagrams, text/code files, Jupyter notebooks and ZIP archives independently.
All nine output kinds are included; **Check tools** verifies the
bundled document engine loads. There is no Python-module installation and no
document-generation service. Use an installed local model and turn Web search
off for fully offline chat; a cloud model still needs its usual internet connection.

Try: “Create a PDF study guide on binary search,” “Make a three-slide PowerPoint
about database normalization,” or “Plot a bar chart: Algorithms 82, Databases 91.”
Orbit tells the selected model which tools are enabled. The model returns
validated structured content, never executable scripts. Files are created
locally and displayed with the upload-style file icons. Click a card to preview; use its download button to save.
Generated files also appear in **Files**, which links back to their conversation.
Suitable numeric Markdown tables have a **Chart** button. Charts support 21 types:
bar, line, pie, doughnut, area, scatter, curve, box, Gantt, horizontal bar,
stacked bar, percent bar, stacked area, step, histogram, heatmap, bubble,
waterfall, radar, funnel and treemap. The chart menu offers compatible type
switches and a data-table view. SVG downloads are static; the chart controls
belong to the Orbit interface.

### Usage

Open **More → Usage** for the last seven local calendar days of activity in this
browser. The dashboard updates when requests finish and includes per-model
attempts, outcomes, provider-reported input/output/total tokens, reasoning and
cached-input tokens when reported, requested thinking modes, observed thinking,
client timing, web searches and page reads. Daily charts, a model request-share
doughnut, and connection/model filters show the breakdown. The doughnut includes
counts and percentages, grouping connections beyond the top seven as Other.
Internal Analyze, naming, memory, web planning,
document drafting/editing and repair requests are counted too; use **Chat replies
only** to filter those out.

Counts are aggregate metadata in IndexedDB, shared between Orbit tabs of the same
browser origin; prompts, responses, keys, search queries and URLs are not stored
in the usage database. Older days are pruned when the database is accessed.
If storage fails, Orbit clearly marks subsequent counts as session-only. Tracking
starts after this update, without reconstructing older chats. Clearing site data
also clears these totals. Closing/reloading during a request may prevent its final
report. Missing token counters are shown as unavailable, with coverage, and are
never estimated from text. This is an Orbit activity dashboard, not a provider
billing statement or an account-wide meter. Web counts cover Orbit operations;
hidden upstream fallback attempts and manual browsing are not measurable.

Diagrams use a custom SVG renderer with explicit model-selected node positions,
shapes, connectors, arrows, labels and architecture groups. Flowcharts, state
machines, graphs, trees, stacks and queues can appear between paragraphs as the
reply streams, with a preparing shimmer while each recipe is incomplete. Up to
32 complete diagram snapshots can appear in one reply (80 nodes and 160 edges
per diagram). Each step is saved independently. Wide diagrams scroll inside the
message; Expand opens a read-only zoomable preview, and Download saves an SVG.
Models are instructed to use diagrams when requested or helpful, and to complete
all requested steps. For numbered `Step N` sections in an established illustrated
sequence, Orbit checks for missing snapshots and makes one bounded completion
request to the selected model alongside any format repairs. Existing diagrams
and prose stay in place; incomplete steps produce a visible error that survives
chat export/import. This check uses Markdown or bold step headings; it cannot
detect every possible narrative format or recover a model response that was
never saved. Model output/token limits still apply; layout and content
accuracy depend on the model. Turn diagrams off separately in Widgets.

File recipes are saved with chat history and chat exports. After reload, Orbit
rebuilds the download from its saved recipe without asking a model again. Browser
storage must remain available; download important files for a separate copy.
The service worker caches the document engine along with the app shell.

Supported documents contain headings, paragraphs, lists, tables, styled text
(colors, bold, italic, underline), and explicit page breaks. Slides contain
editable titles, styled bullets, tables and speaker notes. File creation uses
the thinking shimmer with labels such as “Preparing Word document.” This is not arbitrary
Python execution, a spreadsheet engine, or a full document-design agent. Small
models may fail to follow the tool schema; invalid or incomplete output shows
an error instead of executing code. Charts use supplied numeric data, which
should still be checked against the original source.

### Optional web research

The **Web search** toggle in Widgets lets the selected model decide when public
web research is useful. Explicit requests not to browse take priority. Orbit
uses the signed-in local Ollama runtime's experimental web-search/web-fetch
endpoints first; this also works when LM Studio, Gemini, DeepSeek or AICredits supplies the answering
model, provided Ollama is running and signed in. If Ollama's hosted relay is
unavailable, Orbit tries Bing HTML, Bing RSS, then DuckDuckGo HTML/Lite for up to five
results per search, without another API key. Empty, malformed or unavailable
responses advance to the next engine. Explicit site restrictions remain enforced.
After a quota error Orbit briefly skips the exhausted relay, then checks it again.
If the
Ollama page reader is unavailable, Orbit can also read a public HTTPS HTML page
directly, using the same bounded readable-text budget. Internet access is
required.

Chat can search and read up to two result pages; document requests can perform
a second complementary search. Long reports can make three complementary
searches and retain up to eight sources. Explicit public URLs can also be read.
If the model planner is unavailable, explicitly supplied URLs or a quoted search
query such as `Search the web for "solar energy storage"` can still be retrieved.
This does not remove the answering model's own usage limit. It does not operate a
browser, log into sites, click buttons, download binaries, or execute page code.
The query and requested page URLs go to Ollama's hosted web service or, when the
relay is unavailable, Bing or DuckDuckGo and the requested public page. Full chat history and
uploads are not sent to either service; the selected model proposes a short
public query and is instructed not to include private information. Basic
credential/email checks are not a complete sensitive-data detector: keep Web
search off for confidential conversations.

Sources are attached to the reply and the model is instructed to cite claims.
Retrieved pages are untrusted data, never tool instructions. Failed page reads
may fall back to search excerpts; offline, sign-in and rate-limit errors are
shown without pretending web verification succeeded. No search/page data is
cached in the app shell. Model decisions and citations still need user judgment.

After updating an installed copy, update/restart the Orbit server too: the new
`/api/web/search` and `/api/web/fetch` routes are required. Re-running the existing
installer updates both server and client. Static-file-only hosting cannot proxy
web research. Endpoint requests are loopback-only and reject cross-origin calls.

### Rebuilding the widget bundle (developers only)

The installers copy `widgets.js`, `widgets-ui.js`, and `vendor/widgets/`; end
users do not need npm. To rebuild after changing the engine:

```sh
npm ci
npm run build:widgets
npm run test:widgets
```

The tests validate schemas, disabled tools, unsafe input, and real PDF/Office
binaries. They write sample files to `tests/output/` for visual checks. Third-party
license notices are generated into `vendor/widgets/LICENSES.txt`. The `image-size`
override patches a transitive build dependency; image decoding is excluded from
the browser bundle and this engine does not accept image inputs.

## Install it

The repository includes one-click installers for both operating systems:

- macOS: double-click `install-macos.command`, or run `./install-macos.sh` in Terminal.
- Windows: double-click `install-windows.cmd`, or run `install-windows.ps1` from PowerShell.

Each installer requests administrator access once. It copies Orbit to a stable
system location, creates a machine-specific HTTPS certificate for `orbit.com`,
trusts that certificate, maps `orbit.com` to both IPv4 and IPv6 loopback, and
registers Orbit to start automatically. On Windows it also installs a small
runtime watchdog that repairs Ollama and Orbit after startup, wake-from-sleep,
or an unexpected process exit. A normal install removes any bundled
`orbit.com.pem` or `orbit.com-key.pem` files from the shared folder during the
install, then creates the fresh machine-specific certificate in the protected
system install location. Staging mode leaves the source folder untouched. The
Windows installer installs Python and mkcert through winget when they are
missing; the macOS installer uses Python 3 already installed on the machine,
or installs it through Homebrew when Homebrew is available, and uses the
system OpenSSL plus macOS System Keychain for the local certificate.

The scripts check whether their required tools and Ollama are already available
before taking action. They never download an Ollama model. On Windows, the
installer installs the Ollama application when it is missing, starts it during
installation, and registers a hidden logon bootstrap plus a low-overhead
runtime watchdog that starts Ollama before Orbit and recovers either process
after restart, wake, or failure. On macOS, an already-installed Ollama is
started when available; if it is absent, Orbit remains usable in demo mode
until Ollama is installed. The scripts repair conflicting existing `orbit.com` hosts entries,
flush the platform DNS cache, and verify the new trusted HTTPS server over both
IPv4 and IPv6 before reporting success. They also support an isolated staging
test that does not touch the real hosts file, keychain, or startup services:

```bash
./install-macos.sh --staging-dir /tmp/orbit-install-test
```

On Windows, the equivalent is:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\install-windows.ps1 -StagingRoot $env:TEMP\orbit-install-test
```

The Windows staging test assumes `mkcert` is already installed; the normal
installer installs it automatically when needed.

## Run it

The macOS installer registers Orbit as a system launch daemon, so it starts at
boot and restarts if the server exits. When Ollama is installed, it also
registers a per-user launch agent that starts Ollama at login without creating
a duplicate daemon if Ollama is already running. The Windows installer
registers a per-user scheduled task that starts at logon, has no
execution-time limit, and is configured to restart Orbit after failures. After
the one-time installation, just open:

<https://orbit.com>

The shareable source package intentionally contains no machine-specific
certificate or private key. For a manual foreground development run, create
an isolated install first, then use:

```bash
./install-macos.sh --staging-dir /tmp/orbit-install-test
ORBIT_ROOT=/tmp/orbit-install-test/Orbit \
ORBIT_CERT_FILE=/tmp/orbit-install-test/Orbit/orbit.com.pem \
ORBIT_KEY_FILE=/tmp/orbit-install-test/Orbit/orbit.com-key.pem \
ORBIT_PORT=8443 python3 server.py
```

`orbit.com` is mapped to this computer through the hosts file; it is not a
public website. The HTTPS server proxies `/api/ollama/*` to the local Ollama
daemon, avoiding browser mixed-content and cross-origin problems.

## Install it as an app

Open the URL in Chrome or Edge. Once the page loads, use the install icon in the address bar, or open the browser menu and choose **Install Orbit** / **Save and share → Install page as app**. Orbit includes a web manifest and service worker, so the installed version opens in its own window and keeps the app shell available offline.

On macOS Safari, use **File → Add to Dock** after opening the local URL.

The browser cannot read model folders directly. Ollama and LM Studio expose the
models through their local servers; Orbit connects to those APIs when they are
available. The installers verify that Ollama is answering, but they do not
choose, sign in to, or download a model for you. If no model is available, the
UI stays in demo mode until you add one.

To solve an attached image, select a vision-capable model. Text-only models can receive the request but cannot interpret the image contents.

Modern Office formats (`.docx` and `.pptx`) are supported. Legacy binary `.doc` and `.ppt` files need to be saved as `.docx` or `.pptx` before uploading.

### Excel widget

The Excel widget generates editable `.xlsx` workbooks locally using the same introduction, preparing shimmer, repair, completion and download flow as the other file widgets. Enable or disable it in Widgets. It supports up to 10 sheets, 26 columns and 1,000 rows per sheet within the shared 240,000-character recipe limit, with typed numbers/booleans, text, blank cells, frozen headers and filters. Saved recipes regenerate downloads after reload.

Excel requests can use the same optional web research and follow-up research as document requests; researched workbooks should include source URLs. Workbooks currently contain values rather than formulas, embedded charts or merged cells. Text beginning with `=` remains literal text.

### Spreadsheet uploads

Attach `.xlsx`, `.xls`, `.csv` or `.tsv` through the + menu or drag and drop.
Excel and CSV use the green spreadsheet icon. Excel is read locally with the
bundled SheetJS 0.20.3 reader (https://docs.sheetjs.com/docs/getting-started/installation/standalone/).
Sheet names, cell addresses, formatted saved values and available formulas
are included in the model prompt. Formulas are not recalculated, macros do not
run, and embedded charts/images are not extracted. Password-protected files
need an unencrypted copy. Maximum upload size is 10 MB; extraction is bounded
to 20 sheets, 2,000 rows per sheet, 20,000 populated cells per sheet and 100,000
characters, with truncation marked in the extracted text. CSV/TSV preserves
the original text, including quoted fields and leading zeros. Spreadsheet
reading works offline; cloud models still need their usual connection.

### Notebook uploads and read-only previews

`.ipynb` (Colab/Jupyter) uploads extract markdown, code cells and plain-text
outputs in order without executing cells. Notebooks are limited to 10 MB and
100,000 extracted characters; embedded HTML and binary outputs are not read.
Click an uploaded or generated file pill to preview it. Generated file pills
have a separate download button. Documents open beside chat on desktop and
cover the chat on screens up to 900px wide. Images open in a dark overlay.
Previews include zoom, download and Close controls; Escape also closes them.

PDF previews use the browser PDF viewer. Generated Office files show a
structured content preview; uploaded Word files show converted text/tables,
PowerPoint uploads show slide text, and spreadsheets show bounded tables.
These Office previews are not exact reproductions of pagination, embedded
images or slide design. Older uploads without original files fall back to their
saved extracted text. Reattach them for original-file previews/downloads.

Newly sent originals up to 25 MB are stored locally in IndexedDB when storage
is available; generated files are rebuilt from their recipes. Chat exports do
not include original uploads. Clearing browser site data removes stored originals.

## OpenAI API

Settings → Models → OpenAI connects your own API key. Supported GPT-6 Luna, Sol, 6.1 Sol and Astra models appear when available in your account. Includes model-specific thinking controls, streaming, image input, existing Orbit document/Analyze workflows, usage tracking and API limits. API billing is separate from ChatGPT subscriptions.

See [setup, research sources and validation](docs/openai-api.md). The adapter was tested with synthetic native Responses events; live account access and latency require your own API key.

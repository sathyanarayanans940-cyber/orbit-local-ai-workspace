ORBIT — START HERE
Shareable build: 8 October 2026

1. Extract the entire ZIP first. Keep all files and the vendor folder together.
2. Install:
   Mac: double-click install-macos.command.
   Windows: double-click install-windows.cmd.
3. Approve the administrator prompt. On Mac, Orbit opens https://orbit.com
   automatically after the installation checks pass. If it does not open,
   open that address in your browser.

The installer creates a local HTTPS certificate, maps orbit.com to your own
computer, and configures Orbit to start automatically. This is a local app,
not a public website. No certificate or private key from another computer is
included. Installation may need internet to obtain prerequisites.

MAC INSTALLATION
For automatic installation of the current Ollama release, macOS 14+ is required.
Extract the whole ZIP, then double-click install-macos.command. Enter your Mac
administrator password once when Terminal asks for it; typed characters are
invisible. The installer reuses working Python/Ollama installations, or downloads
missing Python from python.org and Ollama from ollama.com. Internet and enough
free disk space are required for these downloads. Python's pinned SHA-256 and
package signature are checked; Ollama's app signature and macOS assessment are
checked before copying it. Homebrew and developer tools are not required.
Models are not downloaded automatically; choose/add one after installation.
Installing Orbit alone does not supply a language model. On a fresh machine,
add a local model in Ollama or sign in and add a supported cloud model before
expecting real AI replies.
If macOS blocks the downloaded launcher, approve it using macOS's normal
Open Anyway flow only if you trust the sender. This first-open OS approval can
be additional to the installer's administrator password prompt.
If double-clicking is unavailable, open Terminal in this folder and run:
  bash install-macos.sh

WINDOWS REQUIREMENTS
The installer can install Python, mkcert and Ollama with winget when missing.
If winget is unavailable, follow the installer's prerequisite message.

MODELS
Models are not included or downloaded automatically. Add a model in Ollama,
or start LM Studio's local server, then choose the model in Orbit's + menu.
Cloud models need internet and their provider's sign-in. Without a runtime/model,
Orbit shows demo responses. Existing model files are not removed by installation.
For a direct provider API, open Settings > Models and save your own supported
provider key. Your friend's API key is never supplied with this package.
Set your name under Settings > Profile. Start a new chat and choose a real model
from the + menu before sending your first prompt.

FEATURES
Chat, code and math; PDF, Word, PowerPoint and Excel generation; inline charts and diagrams.
Explicitly requested text/source files, Jupyter notebooks and ZIP folders/files
are supported. Ordinary code replies stay in code blocks. ZIP uploads list
folders and read supported members; files are never executed.
The tabbed viewer opens documents, images, spreadsheets, notebooks and source
files side by side. Tabs survive website reloads and load on demand.
Chat tools includes bookmarks, conversation branches, study quizzes/flashcards,
model comparison, prompt shortcuts, code comparison and API limits/budgets.
Requested document edits keep version history. More > Usage shows the last
week's model/search activity and reported token totals; unreported usage is
marked rather than invented. More > Widgets controls file/chart tools.
Online voice dictation puts editable text in the composer. It requires a
supported browser, a confirmed internet connection and microphone permission.
Diagrams support flowcharts, graphs, state machines, trees, stacks, queues and
architecture layouts, including up to 32 steps interleaved with explanations.
Expand to preview, zoom or download SVG. Enable or disable Diagrams in Widgets.
Generated files use bundled libraries: Node/npm is not required.
Excel (.xlsx/.xls) and CSV/TSV uploads are supported with a spreadsheet icon.
The Excel reader is bundled locally and works offline. Files must be 10 MB or
smaller; large sheets are truncated with a notice. Saved values are read;
formulas are not recalculated.
PDF/Word/PowerPoint attachment readers are bundled locally. Web research needs internet. Orbit
uses a signed-in Ollama runtime that supports web search first and falls back to
a bounded public Bing search for snippets if the Ollama relay is unavailable. If
the Ollama page reader is unavailable too, Orbit can read a public HTTPS HTML
page directly with the same bounded text budget. Turn Web search off in Widgets
for offline local-model chat. Cloud models still require internet.

SAFARI
Open https://orbit.com. The macOS installer adds a domain-specific local DNS
resolver so Safari does not use the public site's HTTPS/SVCB address hints.
Quit and reopen Safari after installing to clear old connections. This does
not change your default DNS server or Safari privacy settings. The resolver
is /etc/resolver/orbit.com; its local service is com.orbit.local-dns.

YOUR DATA
Chats and settings belong to your browser profile on this computer; your
friend's chats, API credentials and models are not included. Export important
chats and download generated files before clearing browser storage.
Memories, learned formatting preferences and About me start fresh on your
friend's computer. These features are included in Settings > Profile.

UPDATES
Re-run the installer from a newly extracted Orbit package. Reload the browser
after updating. The source folder can be removed after a successful install;
Orbit runs from the system installation directory.

LICENSES
Third-party notices are in vendor/katex/LICENSE, vendor/widgets/LICENSES.txt
and vendor/sheetjs/LICENSE.

NOTEBOOKS AND PREVIEWS
.ipynb notebooks can be uploaded or generated when explicitly requested. New
notebooks contain Markdown/code/raw cells and start unexecuted, with no saved
outputs. They can also be included in ZIP folders. Download and open in Jupyter
or Colab to run the code; Orbit's viewer never executes notebook cells. Click file
pills for read-only previews, or the separate download icon to save generated
files. Images open in a dark zoomable overlay. On mobile, Close restores chat.
Office previews may differ from the original layout; uploaded PowerPoints show
slide text. Older uploads may need reattaching for full previews/downloads.

OPTIONAL GEMINI
In Orbit, open Settings > Models, paste your own Gemini API key, and click
Save key. Select a Gemini Flash model from the + menu. Gemini needs internet;
local Ollama models can still run offline. Use a Google project without paid
billing for free-tier use; Google controls quotas, availability and pricing.
The key is stored by the local server, not in chat exports or browser storage.
On Mac it is an administrator-only file in the installed Orbit folder; on
Windows it is in your local AppData/Orbit folder. It is not included in this ZIP.
Messages and relevant files/memories go to Google when you select Gemini.
Free-tier content may be used to improve Google's products. Orbit's web search
uses Ollama first and has bounded public search and page-reader fallbacks when
its relay is unavailable.

DEEPSEEK API (OPTIONAL, PAID)
----------------------------
In the installed Orbit app, open Settings > Models > DeepSeek, paste your own
API key from https://platform.deepseek.com/api_keys and click Save key. Choose
an available DeepSeek model from the + menu > Model. Orbit checks availability
with the provider's live catalog; it does not route through Ollama. Image and
thinking support depend on the selected model. Search, Analyze, diagrams and
document generation use Orbit's existing tools.
API usage, including Orbit's supporting model calls, is billed to your account;
see https://api-docs.deepseek.com/quick_start/pricing/ for current pricing.
Keys stay in the installed server's restricted settings file (per-user AppData
on Windows); they are not returned to the browser or included in chat exports.
Messages and relevant files/memories go to DeepSeek when that model is selected.
Remove key in Settings to disconnect. No key or paid account is bundled.
Existing Mac installations need the full server update, not --web-only.
This provider setting is for the installed local app, not the hosted Cloud build.

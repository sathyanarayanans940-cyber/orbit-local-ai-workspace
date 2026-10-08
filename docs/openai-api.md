# OpenAI API in Orbit

Researched and implemented 7 October 2026.

## Setup

Run the full installed-app updater (not `--web-only`), reload Orbit, then open Settings → Models → OpenAI. Save an OpenAI API key and select an OpenAI model from the composer’s model picker. A ChatGPT subscription does not pay for API usage.

Orbit checks `/v1/models` and offers the intersection with its documented model allowlist: GPT-6 Luna, GPT-6 Sol, GPT-6.1 Sol and GPT-6 Astra. Models that are absent from your catalog are not invented or substituted. Catalog access is not proof of funded generation access; the connection check makes no paid generation request.

Luna and GPT-6 Sol: Off, Low, Medium, High, Extra high, Max. GPT-6.1 Sol and Astra: Low through Max. Default is Medium. Internal naming/planning uses Off where supported, otherwise Low; Analyze retains the user’s selected effort. Higher effort can consume more output tokens and time; there is no guaranteed response latency.

## Implementation

- Server-side stdlib gateway uses `POST https://api.openai.com/v1/responses`, bearer authentication and Standard processing (`service_tier: default`). No third-party relay or automatic upgrade.
- Requests use `input`, `reasoning.effort`, `max_output_tokens`, `stream: true`, `store: false`. JSON workflows use `text.format.type: json_object`. No unsupported temperature parameter is forwarded.
- Uses Orbit’s existing document extraction, image attachments, Analyze, file generation and web search workflows. This does not enable OpenAI-hosted search, code interpreter, image generation, transcription or arbitrary provider tools. Model-directed routing uses a fixed native function described below.
- Uploaded images become `input_image` data URIs. Arbitrary remote image URLs and non-image attachments are not forwarded through that field.
- The gateway translates native Responses SSE into Orbit’s existing stream contract. It accepts byte-fragmented Unicode, LF/CRLF/CR separators, comments and multiline data. Text-done events do not duplicate deltas. Only terminal response events finish a stream; EOF alone is an error.
- Reasoning activity is represented by a boolean marker, without requesting or displaying raw reasoning. Existing high-level shimmer labels continue to work.
- Native input/output/total/cache/reasoning token measurements are translated for Usage. Reasoning and cached tokens remain subsets, never added to the total again. Missing counts remain unavailable. Interrupted responses may not report their billed usage.
- Billing exhaustion, bad keys, unsupported models, rate limits, blocked output and incomplete output produce explicit errors. Immediate provider requests do not automatically retry. Existing document recovery may separately retry eligible failures as part of its workflow.
- Stop aborts the browser stream; the upstream connection is closed when the gateway detects disconnect. While waiting on an upstream socket, detection can be delayed until data arrives or the socket timeout expires. Closing a connection does not guarantee that OpenAI stops billable computation immediately.
- Keys are stored in `.orbit-openai.json`, atomically created with mode 0600 on macOS, or under the per-user AppData directory on Windows. They are not returned to the browser or stored in chat exports. This is file permission protection, not encrypted keychain storage. The gateway requires loopback access, the local host/origin and a custom request header. Static serving blocks hidden credential files. Release packaging is allowlisted.
- `store: false` disables Responses storage; it is not a promise of zero retention. OpenAI’s applicable abuse monitoring and account data policies still apply.
- OpenAI participates in Orbit’s API request/token/output/budget controls. These are local estimates and thresholds, not a replacement for provider spending limits.

## Sources and research decisions

Official documentation is the implementation authority:

- [GPT-6 Luna model and efforts](https://developers.openai.com/api/docs/models/gpt-6-luna)
- [GPT-6 Sol model](https://developers.openai.com/api/docs/models/gpt-6-sol)
- [GPT-6.1 Sol model and supported efforts](https://developers.openai.com/api/docs/models/gpt-6.1-sol)
- [GPT-6 Astra model](https://developers.openai.com/api/docs/models/gpt-6-astra)
- [Responses migration: input and storage](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Streaming Responses](https://developers.openai.com/api/docs/guides/streaming-responses)
- [Streaming event reference](https://developers.openai.com/api/reference/resources/responses/streaming-events)
- [Structured outputs and JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Images and vision](https://developers.openai.com/api/docs/guides/images-vision)
- [Model discovery](https://developers.openai.com/api/reference/resources/models/methods/list)
- [Reasoning and output budgets](https://developers.openai.com/api/docs/guides/reasoning)
- [API error codes](https://developers.openai.com/api/docs/guides/error-codes)
- [Authentication and API overview](https://developers.openai.com/api/reference/overview)
- [Data controls](https://developers.openai.com/api/docs/guides/your-data)

Public reports were used as test leads, not as API specifications:

- [Report of newer model/tool failures on Chat Completions](https://www.reddit.com/r/mcp/comments/1w9ptpv/the_newest_openai_models_block_function_tools_on/) motivated a native Responses adapter rather than forwarding an incompatible request unchanged.
- [OpenWebUI/LiteLLM streaming report](https://www.reddit.com/r/OpenWebUI/comments/1u858ru/streaming_issues_with_litellm_openwebui/) motivated checks for incremental delivery and duplicate text/requests.
- [Production integration lessons](https://www.reddit.com/r/OpenAI/comments/1rwgsal/lessons_from_building_a_production_app_that/) informed tests around valid model IDs, API schema boundaries, JSON truncation and concurrent requests.

These reports do not establish general reliability or latency. The initial integration was tested without real OpenAI credentials. Subsequent limited live latency checks are recorded below; they do not establish general account access, rate limits or guaranteed speed.

## Greeting latency correction — 7 October 2026

Orbit previously sent a greeting through the memory, Analyze and web planners before requesting its answer. Those independent requests ran in parallel for remote providers, but the answer still waited for all of them. Think Off did not remove that preparation.

The initial 7 October patch made whole-turn greetings and social acknowledgments without attachments bypass the three planners across all providers. The saved About me and applicable learned preferences still reach the answer, without scanning chat history or updating preferences. Those greeting requests omitted the large file-generation schema. That patch checked the whole current message; greeting prefixes, questions, attachments, `continue`, `yes`, and formatting/memory instructions kept the old preparation. It has now been superseded by the model-driven route below. Automatic naming remains after the answer.

Two tiny live GPT-6 Luna probes through the installed gateway, with `reasoning_effort: none` and a 64-token output ceiling, produced first text in 1.227 s and 1.205 s. Both reported zero reasoning tokens. These measure gateway receipt of text, not the user's screen or a full conversation. A separate synthetic browser test exercised the full send/preparation/render path: one answer request, no planning calls, initial text displayed before completion, and title generation started afterward. See `tests/reports/2026-10-07-greeting-latency.md`.

## Model-driven tool selection — 8 October 2026

Every chat turn now goes to the selected model first. The same streamed request either answers immediately or requests a bounded tool plan. This is provider-independent and does not use a greeting or complexity classifier. Think Off still reaches OpenAI as `reasoning_effort: none`; the routing/answer request uses the user's selected effort because it also writes direct answers.

The model can select memory, web, Analyze and the file/visual stage. Independent remote tools run together. Ordered groups allow Analyze to consume actual prior search/memory results. Local model requests stay serial to avoid simultaneous inference contention. Tool-specific planners run only for selected tools, preserving safe public search queries, executable checks and explicit memory updates. File schemas are loaded only when the model selects that stage. Source/code/notebook/ZIP generation still requires an explicit current-turn request. Necessary image reading can precede routing for attachments.

OpenAI registers a fixed strict `orbit_tools` function with automatic tool choice. The gateway validates its completed arguments (capped at 4096 characters) and emits a hidden dispatch packet. Other providers retain the text control envelope recognized only at the start of a response. Both routes are strictly validated and hidden from the answer. Invalid, incomplete, disabled or unknown tool requests cannot start work. A truncated control envelope does not trigger automatic continuation; ordinary long answers retain their existing bounded continuation. Retries reuse completed work only for the matching conversation/model/settings checkpoint. Document edits receive selected tool evidence before applying their existing original-user-intent gate.

Validation: 718 Node tests, 23 OpenAI gateway tests and 17 browser assertions passed. They cover all six provider request paths, native function registration/streaming, malformed or duplicate calls, boundary-split envelopes, disabled tools, Stop, model pinning, dependency ordering, document edits, checkpoints and automatic continuation. The browser used synthetic model responses with real offline Python execution.

Six approved live GPT-6 Luna probes with Think Off reported zero reasoning tokens and first text at the gateway in 0.900–3.047 seconds. Direct explanations worked, but the original text-only route failed to request web search and Word generation. This prompted the native function-calling correction above, following [OpenAI's function-calling guide](https://developers.openai.com/api/docs/guides/function-calling). Those timings are not screen latency or a guarantee. Evidence and limitations: `tests/reports/2026-10-08-tool-routing.md`.

After the user installed the native adapter, six live probes produced five expected decisions: three direct answers (first text 1.432–1.818 seconds), a web route and a file route. The explicit Python-check request failed because the native schema permitted an empty plan. All six reported zero reasoning tokens. This is selection evidence, not complete live tool execution.

The final correction requires a nonempty `steps` array with nonempty groups and only enabled tools; file work is an explicit final group. The gateway normalizes this to Orbit's existing internal route and validates dependencies and duplicates. The final schema is installed and verified through gateway protocol version 2: all six live routing cases passed, including explicit Python selection. All reported zero reasoning tokens. This batch showed slow direct first-text times of 5.754–14.491 seconds; two follow-up probes returned first text in 2.035 seconds and a Python route in 1.979 seconds. Recorded connection and upstream-header timings are in the report. The variability remains; removing unconditional planning does not guarantee a response time. Live checks covered routing, not complete live web/document execution. The full updater is required for installation; protocol version 2 prevents silent use of the old schema.

## Initial integration validation — 7 October 2026

- `npm test`: 682 passed.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 127 discovered, 113 passed, 14 environment-dependent skips.
- Included 17 new OpenAI gateway tests: key isolation, same-origin checks, catalog caching/key replacement races, native request conversion, supported effort combinations, images, malformed and fragmented streams, truncation, usage subsets, quota errors and disconnected clients.
- Browser test on an isolated localhost gateway with synthetic upstream events: settings save/catalog, model selection, six-level slider and Off selection, completed streamed chat, automatic title and persisted usage (3 requests, 420 reported tokens, 240 cached input tokens, 0 reasoning tokens with Off).
- Python compilation and macOS shell syntax checks passed. No live API key was used. Windows installer payload was checked; Windows installation itself was not run.

## Direct tool inputs — 8 October 2026

Gateway protocol 3 extends the strict native function with nullable structured web, Analyze and memory inputs. The selected model supplies inputs in the same request that chooses the tool. Valid independent inputs skip the worker planner; dependent calculation, privacy-isolated web planning and repair preserve existing behavior. File content still goes through the normal generator after tool results. The 65,536-character route limit accommodates escaped Python while its execution limit remains 16,000 characters.

Validation: 727 Node tests and 24 synthetic gateway tests pass. After installation, all six live protocol-3 selection checks passed with zero reasoning tokens. Three direct answers began in 1.305–2.143 seconds. Four live integration cases also passed: direct answer, real search, constrained Python verification to Word, and a supplied web page to Word. Both Word files were actually generated and their contents checked. The Python-to-Word path used exactly two model requests; privacy fallback and document research coverage still added a request in the two web cases. Browser verification remains blocked by a saved permission setting, so these timings measure API/token callbacks rather than screen paint, and the live arithmetic test does not validate browser Pyodide. See `tests/reports/2026-10-08-direct-tool-inputs.md` for evidence and limits.

The shared frontend now supplies a compact enabled-widget inventory before routing and full schemas during generation. Generic public query vocabulary is shared with the web validator. Exact successful image readings can be reused within the session for the same model/effort. PPT/local-field repair and mixed-kind repair preserve valid outputs. Protocol stays at 3; see [all-tool audit](../tests/reports/2026-10-08-all-tool-efficiency.md) for live results, residual repair calls and browser limitations.

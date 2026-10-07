# OpenAI API in Orbit

Researched and implemented 7 October 2026.

## Setup

Run the full installed-app updater (not `--web-only`), reload Orbit, then open Settings → Models → OpenAI. Save an OpenAI API key and select an OpenAI model from the composer’s model picker. A ChatGPT subscription does not pay for API usage.

Orbit checks `/v1/models` and offers the intersection with its documented model allowlist: GPT-6 Luna, GPT-6 Sol, GPT-6.1 Sol and GPT-6 Astra. Models that are absent from your catalog are not invented or substituted. Catalog access is not proof of funded generation access; the connection check makes no paid generation request.

Luna and GPT-6 Sol: Off, Low, Medium, High, Extra high, Max. GPT-6.1 Sol and Astra: Low through Max. Default is Medium. Internal naming/planning uses Off where supported, otherwise Low; Analyze retains the user’s selected effort. Higher effort can consume more output tokens and time; there is no guaranteed response latency.

## Implementation

- Server-side stdlib gateway uses `POST https://api.openai.com/v1/responses`, bearer authentication and Standard processing (`service_tier: default`). No third-party relay or automatic upgrade.
- Requests use `input`, `reasoning.effort`, `max_output_tokens`, `stream: true`, `store: false`. JSON workflows use `text.format.type: json_object`. No unsupported temperature parameter is forwarded.
- Uses Orbit’s existing document extraction, image attachments, Analyze, file generation and web search workflows. This does not enable OpenAI-hosted search, code interpreter, image generation, transcription or native function-tool calls.
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

These reports do not establish general reliability or latency. No real OpenAI credential was available during development, so no live OpenAI response, rate limit, billing permission or speed claim has been verified.

## Validation

- `npm test`: 682 passed.
- `python3 -m unittest discover -s tests -p 'test_*.py'`: 127 discovered, 113 passed, 14 environment-dependent skips.
- Included 17 new OpenAI gateway tests: key isolation, same-origin checks, catalog caching/key replacement races, native request conversion, supported effort combinations, images, malformed and fragmented streams, truncation, usage subsets, quota errors and disconnected clients.
- Browser test on an isolated localhost gateway with synthetic upstream events: settings save/catalog, model selection, six-level slider and Off selection, completed streamed chat, automatic title and persisted usage (3 requests, 420 reported tokens, 240 cached input tokens, 0 reasoning tokens with Off).
- Python compilation and macOS shell syntax checks passed. No live API key was used. Windows installer payload was checked; Windows installation itself was not run.

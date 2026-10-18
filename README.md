# Orbit — AI Workspace

![Orbit project overview](assets/overview.svg)

**A personal software project by [Sathyanarayanan S](https://github.com/sathyanarayanans940-cyber).**

Orbit brings local AI models, optional API providers, persistent conversations, document tools and cross-chat recall into one workspace. I have developed it since September 2026, with ongoing work on reliability, responsive layouts and efficient model context.

**[Try Lunivilo, the hosted companion](https://lunivilo.pages.dev)** · **[View my profile](https://github.com/sathyanarayanans940-cyber)**

This is the public project showcase. The application source, development history and installer releases are maintained privately. Technical source review can be arranged with the maintainer.

## What the project does

| Area | Capabilities |
| --- | --- |
| Conversations | Persistent chat history, file attachments, search and project organization |
| Models | Ollama and LM Studio locally; optional OpenAI, Anthropic Claude, DeepSeek and Gemini adapters |
| Spending controls | User-managed model/provider allowlists, usage accounting and input-tier safeguards |
| Documents | Structured PDF, Word, PowerPoint, Excel, notebook, text and ZIP generation with previews |
| Visuals | Native SVG charts and diagrams, Cartesian plots, hull computation and saved-geometry repair |
| Memory | Automatic bounded cross-chat continuity, original-source excerpts and local meaning search |
| Long chats | Context compaction with problem/answer records and retrieval of original passages |
| Interface | Light/dark/custom themes, responsive phone layouts and PWA support |

## Engineering approach

The local application uses a JavaScript interface, IndexedDB persistence and Python provider gateways. Structured recipes are validated before the document and SVG engines render them. Provider adapters keep model capabilities, usage and streaming behavior consistent with the workspace.

Cross-chat retrieval combines exact search with a small local meaning model. Evidence is bounded, attributed to original messages and invalidated after edits or deletion. Long-context controls preserve recorded problems and answers rather than dropping older messages indiscriminately.

Lunivilo is the separately hosted companion, built on Cloudflare with Google sign-in and optional Google Drive synchronization. Users provide their own supported model-provider credentials. API usage is billed by the selected provider.

## Validation and current status

As of 18 October 2026, the shared development workspace passes **1,049 Node tests**. An isolated Orbit source checkout passes **998 Node tests**, with two hosted-only parity checks skipped. Python contract checks pass **147 tests**, with 14 platform/environment-dependent skips.

Coverage includes streaming, tool routing, context guards, memory retrieval, diagram geometry, document recovery, model selection and persistence. Browser checks are run separately for desktop and mobile layouts.

This remains an actively developed personal project. Generated content depends on the selected model; automated checks do not guarantee every output is correct.

## Screens and demo

The hosted companion is available at **https://lunivilo.pages.dev**. Google sign-in is required, and model generation requires a supported provider connection. No provider credentials are distributed in this showcase.

## Source access

This public repository contains project documentation and presentation assets only. It does not contain application code, installable source archives or credentials. Recruiters and technical reviewers can contact the maintainer through the linked GitHub profile to arrange a review.

© 2026 Sathyanarayanan S. Third-party components retain their respective licenses.

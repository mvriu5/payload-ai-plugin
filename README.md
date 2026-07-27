# payload-ai-plugin

AI assistant plugin for Payload CMS. It adds an admin dashboard assistant that can read CMS context, use mentions, and create signed action proposals for create, update, delete, and global updates.

## Install

```bash
npm add @mvriu5/payload-ai @ai-sdk/openai
```

Install only the provider SDKs you actually use:

```bash
npm add @mvriu5/payload-ai @ai-sdk/anthropic
npm add @mvriu5/payload-ai @ai-sdk/google
npm add @mvriu5/payload-ai @ai-sdk/mistral
```

OpenRouter uses the community OpenRouter provider:

```bash
npm add @mvriu5/payload-ai @openrouter/ai-sdk-provider
```

## Usage

```ts
import { buildConfig } from "payload"
import { payloadAiPlugin } from "@mvriu5/payload-ai"

export default buildConfig({
    plugins: [
        payloadAiPlugin({
            collections: {
                posts: true,
            },
        }),
    ],
})
```

Without centrally configured providers, the plugin adds two fields to the configured Payload admin user collection:

- `aiProvider`
- `aiApiKey`

Users can select their provider and optionally store their own API key in account settings. If no account-level key is set, the chat endpoint uses provider environment variables.

When `providers` is configured, provider selection and API keys are managed centrally. The plugin does not add either field to the user collection. All configured provider models are grouped by provider in the AI input.

## Options

```ts
import type { PayloadAIPluginOptions } from "@mvriu5/payload-ai"

const options: PayloadAIPluginOptions = {
    aiInput: true,
    allowUserApiKeys: false,
    authCollections: {
        aiInput: false,
        generateFields: false,
    },
    collections: {
        media: {
            read: true,
            update: true,
        },
        posts: {
            read: true,
            create: true,
            update: true,
            delete: false,
        },
        users: true,
    },
    generateFields: true,
    media: {
        enabled: true,
        collectionSlug: "media",
        acceptedMimeTypes: ["image/*"],
        maxFileSize: 10 * 1024 * 1024,
    },
    providers: [
        {
            id: "company-openai",
            label: "Company OpenAI",
            provider: "openai",
            apiKey: process.env.COMPANY_OPENAI_API_KEY,
            models: [
                { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
                { label: "GPT-4.1", value: "gpt-4.1" },
            ],
            defaultModel: "gpt-4.1-mini",
        },
        {
            id: "ollama",
            label: "Local Ollama",
            provider: "openai",
            baseURL: "http://localhost:11434/v1",
            apiKey: "ollama",
            models: [
                { label: "Llama 3.3", value: "llama3.3" },
                { label: "Qwen 3", value: "qwen3" },
            ],
        },
    ],
    maxOutputTokens: 1200,
    promptCaching: true,
    translate: true,
    uploadCollections: {
        aiInput: true,
        generateFields: false,
    },
    maxTokenUsage: {
        type: "user",
        perDay: 50_000,
        perWeek: 250_000,
    },
}
```

`models` configures model choices for the user-selected provider mode. Use `providers` instead when provider selection, credentials, and endpoints should be managed centrally.

### `aiInput`

Controls whether the collapsible AI Assistant input is added to collection and global edit views. It defaults to `true`.

```ts
payloadAiPlugin({
    aiInput: false,
})
```

Disabling this option does not remove the AI dashboard or per-field Generate controls.

### `generateFields`

Controls whether supported fields receive a Generate control. It defaults to `true`.

```ts
payloadAiPlugin({
    generateFields: false,
})
```

Generate controls are added to `text`, `textarea`, `richText`, and `json` fields in collection and global edit views. When disabled, the plugin also omits the `/ai-generate-field` endpoint. The embedded AI Assistant and dashboard remain available.

### `authCollections` and `uploadCollections`

Auth and upload collections do not receive the embedded AI Assistant or Generate controls by default. Enable either feature explicitly for the respective collection type:

```ts
payloadAiPlugin({
    authCollections: {
        aiInput: true,
        generateFields: true,
    },
    uploadCollections: {
        aiInput: true,
        generateFields: true,
    },
})
```

The global `aiInput` and `generateFields` options still take precedence when set to `false`.

### `translate`

Controls document translation for localized collections and globals. It defaults to `true`.

```ts
payloadAiPlugin({
    translate: false,
})
```

When enabled, the plugin adds a `Translate` action to the document header. It is shown only when:

- a non-default locale is selected
- at least one localized field is empty in that locale
- the corresponding field in the default locale contains source content

Translation fills only empty localized fields in the current Payload form and marks it as modified. Existing translated values are never overwritten. It does not save the document or global, so the generated values can be reviewed and validated before saving.

When disabled, the plugin does not register the header control or the `/ai-translate-document` endpoint.

### `collections`

Restricts AI read and write proposals to enabled collection slugs. If omitted, all non-internal Payload collections are available.

Use `true` to enable all AI actions for a collection:

```ts
payloadAiPlugin({
    collections: {
        posts: true,
    },
})
```

Use granular permissions to control each action:

```ts
payloadAiPlugin({
    collections: {
        posts: {
            read: true,
            create: true,
            update: true,
            delete: false,
        },
    },
})
```

You can mix both forms in the same object:

```ts
payloadAiPlugin({
    collections: {
        posts: true,
        pages: true,
        users: {
            read: true,
            update: true,
        },
    },
})
```

`read` controls schema/context access, document search, and mentions. `create`, `update`, and `delete` control AI action proposals and server-side apply permissions.

### `media`

Enables media uploads from the AI assistant. Uploaded files are created through the configured Payload upload collection and then passed to the chat endpoint as media attachments.

```ts
payloadAiPlugin({
    collections: {
        media: {
            read: true,
            update: true,
        },
        posts: true,
    },
    media: {
        enabled: true,
        collectionSlug: "media",
        acceptedMimeTypes: ["image/*"],
        maxFileSize: 10 * 1024 * 1024,
    },
})
```

`collectionSlug` defaults to `"media"`. The target collection must be configured with Payload `upload` support.

`acceptedMimeTypes` accepts exact MIME types such as `"image/png"` and wildcard groups such as `"image/*"`. If omitted, all file types accepted by the upload collection can be sent to the endpoint.

`maxFileSize` is checked before creating the upload document. The value is in bytes.

If you want the AI to use uploaded files in other documents, enable `read` on the media collection so the chat endpoint can validate and inspect the uploaded media document. If the media collection has editable fields such as `alt`, `caption`, or `credit` and you want the AI to fill them, also enable `update` for that collection.

Upload references in AI proposals are restricted to the uploaded attachments for the current request. This prevents the model from inventing arbitrary media IDs for upload fields.

### `models`

Overrides the model list shown in the admin UI and the default model per provider.

Built-in providers are `openai`, `openrouter`, `claude`, `mistral`, and `google`.

OpenRouter includes these built-in model options:

- `openrouter/auto`
- `openai/gpt-oss-120b`
- `openai/gpt-4o-mini`
- `anthropic/claude-3.5-sonnet`
- `google/gemini-2.0-flash-001`

### `providers`

Enables centrally managed provider profiles. Each profile supports:

- `id`: unique provider profile identifier
- `label`: provider group label shown in the model select
- `provider`: SDK adapter (`openai`, `openrouter`, `claude`, `mistral`, or `google`)
- `models`: allowed model list
- `defaultModel`: optional default; otherwise the first configured model is used
- `baseURL`: optional custom provider URL
- `apiKey`: optional server-side API key

When at least one profile is configured:

- `aiProvider` and `aiApiKey` are not added to the admin user collection.
- Models from every configured profile are displayed in provider groups.
- The chat endpoint validates both provider IDs and model IDs against this configuration.
- User-level provider and API key values are ignored.

`apiKey` and `baseURL` remain server-side and are not included in Payload's public admin configuration. Custom endpoints must implement the protocol expected by their selected SDK adapter. For Ollama, vLLM, and similar APIs, use the `openai` adapter with an OpenAI-compatible `/v1` endpoint.

### `maxOutputTokens`

Controls the maximum number of output tokens the chat endpoint may generate per request. If omitted, the plugin uses `700`.

```ts
payloadAiPlugin({
    maxOutputTokens: 1200,
})
```

### `maxTokenUsage`

Limits total AI tokens across rolling 24-hour and 7-day windows.

```ts
payloadAiPlugin({
    maxTokenUsage: {
        type: "user",
        perDay: 50_000,
        perWeek: 250_000,
    },
})
```

Use `type: "user"` to enforce separate budgets per authenticated user, or `type: "site"` to share one budget across the entire Payload installation. `perDay` and `perWeek` are optional individually, but at least one must be configured.

Completed model usage is stored in the hidden `payload-ai-usage` collection. Requests made after a limit is reached return HTTP `429`. Because providers report token usage after completion, the request that crosses a limit is allowed to finish and subsequent requests are blocked.

### `promptCaching`

Enables provider prompt-caching hints and defaults to `true`. The chat endpoint keeps static instructions and Payload schemas in a stable prompt prefix, adds Anthropic cache-control breakpoints, and supplies a stable OpenAI prompt cache key. Gemini uses the same stable prefix with its implicit caching.

```ts
payloadAiPlugin({
    promptCaching: false,
})
```

Disable it when explicit provider-side caching is not desired. Dynamic document data and user prompts are never placed in the cacheable schema section. Managed providers with a custom `baseURL` receive the stable prefix but no provider-specific cache parameters, preserving compatibility with Ollama, vLLM, and other OpenAI-compatible endpoints.

### `allowUserApiKeys`

Controls whether the plugin adds an `aiApiKey` field to the admin user collection.

```ts
payloadAiPlugin({
    allowUserApiKeys: false,
})
```

When disabled, users can still select an AI provider, but API keys must come from environment variables.

This option only applies when `providers` is not configured. Managed provider mode never adds user-level AI settings.

### `disabled`

Disables endpoint and UI registration while keeping the plugin call in your config.

## Provider Environment Variables

The package lazy-loads provider SDKs at runtime. If a user selects `claude`, `google`, `mistral`, `openai`, or `openrouter`, the matching provider package must be installed in the host app.
`openrouter` uses `@openrouter/ai-sdk-provider`.

API key priority is:

1. managed provider `apiKey`, when `providers` is configured
2. account-level API key, unless `allowUserApiKeys: false`
3. provider environment variables

- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_GENERATIVE_AI_MODEL`
- `MISTRAL_API_KEY`, `MISTRAL_MODEL`

`PAYLOAD_SECRET` is required for signing AI action proposals.

## Security

AI write operations are proposal-based. The chat endpoint signs every proposal with an HMAC signature and a short TTL. The apply endpoint verifies the signature, validates the target collection/global, enforces Payload access control with `overrideAccess: false`, and rejects proposals containing sensitive API-key-like fields.

The apply endpoint returns only minimal status/doc references and does not return normalized data, proposal payloads, API keys, or raw error details to the client.

## Exports

```ts
import { payloadAiPlugin } from "@mvriu5/payload-ai"
import type { PayloadAiPluginOptions } from "@mvriu5/payload-ai"
```

Client components are exported through:

```ts
import { AIInput, AIApiKeyField } from "@mvriu5/payload-ai/client"
```

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
import { buildConfig } from "payload";
import { payloadAiPlugin } from "@mvriu5/payload-ai";

export default buildConfig({
  plugins: [
    payloadAiPlugin({
      collections: {
        posts: true,
      },
    }),
  ],
});
```

The plugin adds two fields to the configured Payload admin user collection:

- `aiProvider`
- `aiApiKey`

Users can select their provider and optionally store their own API key in account settings. If no account-level key is set, the chat endpoint uses provider environment variables.

## Options

```ts
import type { PayloadAiPluginOptions } from "@mvriu5/payload-ai";

const options: PayloadAiPluginOptions = {
  allowUserApiKeys: false,
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
  media: {
    enabled: true,
    collectionSlug: "media",
    acceptedMimeTypes: ["image/*"],
    maxFileSize: 10 * 1024 * 1024,
  },
  models: {
    defaults: {
      openai: "gpt-4.1-mini",
      openrouter: "openai/gpt-oss-120b",
    },
    providers: {
      openai: [
        { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
        { label: "GPT-4.1", value: "gpt-4.1" },
      ],
    },
  },
  maxOutputTokens: 1200,
};
```

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

### `maxOutputTokens`

Controls the maximum number of output tokens the chat endpoint may generate per request. If omitted, the plugin uses `700`.

```ts
payloadAiPlugin({
  maxOutputTokens: 1200,
})
```

### `allowUserApiKeys`

Controls whether the plugin adds an `aiApiKey` field to the admin user collection.

```ts
payloadAiPlugin({
  allowUserApiKeys: false,
})
```

When disabled, users can still select an AI provider, but API keys must come from environment variables.

### `disabled`

Disables endpoint and UI registration while keeping the plugin call in your config.

## Provider Environment Variables

The package lazy-loads provider SDKs at runtime. If a user selects `claude`, `google`, `mistral`, `openai`, or `openrouter`, the matching provider package must be installed in the host app.
`openrouter` uses `@openrouter/ai-sdk-provider`.

API key priority is:

1. account-level API key, unless `allowUserApiKeys: false`
2. provider environment variables

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
import { payloadAiPlugin } from "@mvriu5/payload-ai";
import type { PayloadAiPluginOptions } from "@mvriu5/payload-ai";
```

Client components are exported through:

```ts
import { AIInput, AIApiKeyField } from "@mvriu5/payload-ai/client";
```

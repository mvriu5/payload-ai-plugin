# payload-ai-plugin

AI assistant plugin for Payload CMS. It adds an admin dashboard assistant that can read CMS context, use mentions, and create signed action proposals for create, update, delete, and global updates.

## Install

```bash
npm add @mvriu5/payload-ai
```

## Usage

```ts
import { buildConfig } from "payload";
import { payloadAiPlugin } from "payload-ai-plugin";

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

Users can select their provider and store their own API key in account settings. The key is used server-side when the chat endpoint calls the selected model.

## Options

```ts
import type { PayloadAiPluginOptions } from "payload-ai-plugin";

const options: PayloadAiPluginOptions = {
  collections: {
    posts: true,
  },
  models: {
    defaults: {
      openai: "gpt-4.1-mini",
    },
    providers: {
      openai: [
        { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
        { label: "GPT-4.1", value: "gpt-4.1" },
      ],
    },
  },
};
```

### `collections`

Restricts AI read and write proposals to enabled collection slugs. If omitted, all non-internal Payload collections are available.

### `models`

Overrides the model list shown in the admin UI and the default model per provider.

### `disabled`

Disables endpoint and UI registration while keeping the plugin call in your config.

## Provider Environment Variables

Account-level API keys take priority. If a user has no key configured, the server falls back to provider environment variables:

- `OPENAI_API_KEY`, `OPENAI_MODEL`
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_GENERATIVE_AI_MODEL`
- `MISTRAL_API_KEY`, `MISTRAL_MODEL`

`PAYLOAD_SECRET` is required for signing AI action proposals.

## Security

AI write operations are proposal-based. The chat endpoint signs every proposal with an HMAC signature and a short TTL. The apply endpoint verifies the signature, validates the target collection/global, enforces Payload access control with `overrideAccess: false`, and rejects proposals containing sensitive API-key-like fields.

The apply endpoint returns only minimal status/doc references and does not return normalized data, proposal payloads, API keys, or raw error details to the client.

## Exports

```ts
import { payloadAiPlugin } from "payload-ai-plugin";
import type { PayloadAiPluginOptions } from "payload-ai-plugin";
```

Client components are exported through:

```ts
import { AIInput, AIApiKeyField } from "payload-ai-plugin/client";
```

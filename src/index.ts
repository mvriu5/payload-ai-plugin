import type { CollectionSlug, Config } from "payload";

import {
  aiProviders,
  getResolvedAIModelConfig,
  type AIModelConfig,
} from "./ai/providerOptions.js";
import { createAIApplyActionEndpointHandler } from "./endpoints/aiApplyActionEndpointHandler.js";
import { createAIChatEndpointHandler } from "./endpoints/aiChatEndpointHandler.js";
import { createAIMentionSuggestionsEndpointHandler } from "./endpoints/aiMentionSuggestionsEndpointHandler.js";
import {
  resolveCollectionPermissions,
  type AICollectionPermissionConfig,
} from "./payload/collectionPermissions.js";

export type PayloadAiPluginOptions = {
  collections?: Partial<Record<CollectionSlug, AICollectionPermissionConfig>>;
  disabled?: boolean;
  models?: AIModelConfig;
};

export type PayloadAiPluginConfig = PayloadAiPluginOptions;

const addAccountFields = (config: Config) => {
  const adminUserSlug = config.admin?.user;
  if (!adminUserSlug || !config.collections) return;

  const userCollection = config.collections.find(
    (c) => c.slug === adminUserSlug,
  );
  if (!userCollection) return;

  userCollection.fields.push(
    {
      name: "aiProvider",
      type: "select",
      defaultValue: "openai",
      options: aiProviders,
    },
    {
      name: "aiApiKey",
      type: "text",
      admin: {
        components: {
          Field: "payload-ai-plugin/client#AIApiKeyField",
        },
      },
    },
  );
};

export const payloadAiPlugin =
  (pluginOptions: PayloadAiPluginOptions) =>
  (config: Config): Config => {
    const incomingOnInit = config.onInit;
    const collectionPermissions = resolveCollectionPermissions(
      pluginOptions.collections,
    );
    const modelConfig = getResolvedAIModelConfig(pluginOptions.models);

    if (!config.collections) config.collections = [];

    addAccountFields(config);

    if (pluginOptions.disabled) return config;
    if (!config.endpoints) config.endpoints = [];
    if (!config.admin) config.admin = {};
    config.admin.custom = {
      ...(config.admin.custom || {}),
      payloadAiPlugin: {
        ...((config.admin.custom?.payloadAiPlugin as
          | Record<string, unknown>
          | undefined) || {}),
        models: modelConfig,
      },
    };
    if (!config.admin.components) config.admin.components = {};

    if (!config.admin.components.beforeDashboard)
      config.admin.components.beforeDashboard = [];
    config.admin.components.beforeDashboard.push(
      `payload-ai-plugin/client#AIInput`,
    );

    config.endpoints.push({
      handler: createAIChatEndpointHandler({
        collections: collectionPermissions,
        models: modelConfig,
      }),
      method: "post",
      path: "/ai-chat",
    });
    config.endpoints.push({
      handler: createAIApplyActionEndpointHandler({
        collections: collectionPermissions,
      }),
      method: "post",
      path: "/ai-apply-action",
    });
    config.endpoints.push({
      handler: createAIMentionSuggestionsEndpointHandler({
        collections: collectionPermissions,
      }),
      method: "post",
      path: "/ai-mention-suggestions",
    });

    if (incomingOnInit) {
      config.onInit = async (payload) => {
        await incomingOnInit(payload);
      };
    }

    return config;
  };

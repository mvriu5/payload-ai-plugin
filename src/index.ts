import type { CollectionConfig, Config } from "payload";

import {
  aiProviders,
  getResolvedAIModelConfig,
  type AIModelConfig,
} from "./ai/providerOptions.js";
import { createAIApplyActionEndpointHandler } from "./endpoints/aiApplyActionEndpointHandler.js";
import { createAIChatEndpointHandler } from "./endpoints/aiChatEndpointHandler.js";
import { createAIMentionSuggestionsEndpointHandler } from "./endpoints/aiMentionSuggestionsEndpointHandler.js";
import { createAIProposalDiffEndpointHandler } from "./endpoints/aiProposalDiffEndpointHandler.js";
import { createAIRecentChangesEndpointHandler } from "./endpoints/aiRecentChangesEndpointHandler.js";
import {
  resolveCollectionPermissions,
  type AICollectionPermissionMap,
} from "./payload/collectionPermissions.js";
import { isInternalCollection } from "./payload/shared.js";

export type PayloadAiPluginOptions = {
  allowUserApiKeys?: boolean;
  collections?: AICollectionPermissionMap;
  disabled?: boolean;
  maxOutputTokens?: number;
  models?: AIModelConfig;
};

export type PayloadAiPluginConfig = PayloadAiPluginOptions;

const aiChangesCollectionSlug = "payload-ai-changes";

const createAIChangesCollection = (): CollectionConfig => ({
  slug: aiChangesCollectionSlug,
  access: {
    create: () => false,
    delete: () => false,
    read: ({ req }) => Boolean(req.user),
    update: () => false,
  },
  admin: {
    defaultColumns: ["title", "action", "additions", "removals", "createdAt"],
    group: "AI",
    useAsTitle: "title",
  },
  labels: {
    plural: "AI Changes",
    singular: "AI Change",
  },
  fields: [
    {
      name: "title",
      type: "text",
      required: true,
    },
    {
      name: "action",
      type: "select",
      options: ["create", "update", "delete", "updateGlobal"],
      required: true,
    },
    {
      name: "targetType",
      type: "select",
      options: ["collection", "global"],
      required: true,
    },
    {
      name: "collection",
      type: "text",
    },
    {
      name: "slug",
      type: "text",
    },
    {
      name: "documentID",
      type: "text",
    },
    {
      name: "targetURL",
      type: "text",
    },
    {
      name: "additions",
      type: "number",
      defaultValue: 0,
    },
    {
      name: "removals",
      type: "number",
      defaultValue: 0,
    },
    {
      name: "before",
      type: "json",
    },
    {
      name: "after",
      type: "json",
    },
    {
      name: "proposal",
      type: "json",
    },
    {
      name: "prompt",
      type: "textarea",
    },
    {
      name: "aiResponse",
      type: "textarea",
    },
    {
      name: "userID",
      type: "text",
    },
    {
      name: "userLabel",
      type: "text",
    },
  ],
  timestamps: true,
});

const addAccountFields = ({
  allowUserApiKeys,
  config,
}: {
  allowUserApiKeys: boolean;
  config: Config;
}) => {
  const adminUserSlug = config.admin?.user;
  if (!adminUserSlug || !config.collections) return;

  const userCollection = config.collections.find(
    (c) => c.slug === adminUserSlug,
  );
  if (!userCollection) return;

  userCollection.fields.push({
    name: "aiProvider",
    type: "select",
    defaultValue: "openai",
    label: "AI Provider",
    options: aiProviders,
  });

  if (allowUserApiKeys) {
    userCollection.fields.push({
      name: "aiApiKey",
      type: "text",
      admin: {
        components: {
          Field: "payload-ai-plugin/client#AIApiKeyField",
        },
        description:
          "Optional. If empty, the plugin uses the provider API key from environment variables.",
      },
      label: "AI API Key",
    });
  }
};

export const payloadAiPlugin =
  (pluginOptions: PayloadAiPluginOptions) =>
  (config: Config): Config => {
    const incomingOnInit = config.onInit;
    const collectionPermissions = resolveCollectionPermissions(
      pluginOptions.collections,
    );
    const allowUserApiKeys = pluginOptions.allowUserApiKeys !== false;
    const modelConfig = getResolvedAIModelConfig(pluginOptions.models);
    const maxOutputTokens =
      typeof pluginOptions.maxOutputTokens === "number" &&
      Number.isFinite(pluginOptions.maxOutputTokens) &&
      pluginOptions.maxOutputTokens > 0
        ? Math.floor(pluginOptions.maxOutputTokens)
        : undefined;

    if (!config.collections) config.collections = [];
    if (
      !config.collections.some(
        (collection) => collection.slug === aiChangesCollectionSlug,
      )
    ) {
      config.collections.push(createAIChangesCollection());
    }

    addAccountFields({ allowUserApiKeys, config });

    if (pluginOptions.disabled) return config;
    const mentionCollectionSlugs = config.collections
      .filter((collection) => !isInternalCollection(collection.slug))
      .filter((collection) =>
        collectionPermissions
          ? Boolean(collectionPermissions[collection.slug]?.read)
          : true,
      )
      .map((collection) => collection.slug);

    if (!config.endpoints) config.endpoints = [];
    if (!config.admin) config.admin = {};
    config.admin.custom = {
      ...(config.admin.custom || {}),
      payloadAiPlugin: {
        ...((config.admin.custom?.payloadAiPlugin as
          | Record<string, unknown>
          | undefined) || {}),
        collectionSlugs: mentionCollectionSlugs,
        allowUserApiKeys,
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
        allowUserApiKeys,
        collections: collectionPermissions,
        maxOutputTokens,
        models: modelConfig,
      }),
      method: "post",
      path: "/ai-chat",
    });
    config.endpoints.push({
      handler: createAIApplyActionEndpointHandler({
        changeLogCollection: aiChangesCollectionSlug,
        collections: collectionPermissions,
      }),
      method: "post",
      path: "/ai-apply-action",
    });
    config.endpoints.push({
      handler: createAIRecentChangesEndpointHandler({
        changeLogCollection: aiChangesCollectionSlug,
      }),
      method: "get",
      path: "/ai-recent-changes",
    });
    config.endpoints.push({
      handler: createAIProposalDiffEndpointHandler({
        collections: collectionPermissions,
      }),
      method: "post",
      path: "/ai-proposal-diff",
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

import type { CollectionSlug, Config } from "payload";

import { aiProviders } from "./ai/providerOptions.js";
import { aiApplyActionEndpointHandler } from "./endpoints/aiApplyActionEndpointHandler.js";
import { aiChatEndpointHandler } from "./endpoints/aiChatEndpointHandler.js";
import { aiMentionSuggestionsEndpointHandler } from "./endpoints/aiMentionSuggestionsEndpointHandler.js";

export type PayloadAiPluginConfig = {
    collections?: Partial<Record<CollectionSlug, true>>;
    disabled?: boolean;
};

const addAccountFields = (config: Config) => {
    const adminUserSlug = config.admin?.user;
    if (!adminUserSlug || !config.collections) return;

    const userCollection = config.collections.find((c) => c.slug === adminUserSlug);
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

export const payloadAiPlugin = (pluginOptions: PayloadAiPluginConfig) => (config: Config): Config => {
    if (!config.collections) config.collections = [];

    addAccountFields(config);

    if (pluginOptions.disabled) return config;
    if (!config.endpoints) config.endpoints = [];
    if (!config.admin) config.admin = {};
    if (!config.admin.components) config.admin.components = {};
    if (!config.admin.components.beforeDashboard) config.admin.components.beforeDashboard = [];

    config.admin.components.beforeDashboard.push(`payload-ai-plugin/client#AIInput`);
    config.endpoints.push({
        handler: aiChatEndpointHandler,
        method: "post",
        path: "/ai-chat",
    });
    config.endpoints.push({
        handler: aiApplyActionEndpointHandler,
        method: "post",
        path: "/ai-apply-action",
    });
    config.endpoints.push({
        handler: aiMentionSuggestionsEndpointHandler,
        method: "post",
        path: "/ai-mention-suggestions",
    });

    config.onInit = async (payload) => await config.onInit?.(payload);
    return config;
};

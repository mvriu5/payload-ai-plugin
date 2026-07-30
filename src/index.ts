import type { Config } from "payload"

import { getResolvedAIModelConfig, resolveAIProviderConfigs } from "./ai/providerOptions.js"
import { resolveMaxTokenUsageOptions, tokenUsageCollectionSlug } from "./ai/tokenUsage.js"
import { isInternalCollection } from "./payload/shared.js"
import { resolveCollectionPermissions } from "./payload/collectionPermissions.js"
import { addAccountFields, addAIFieldsToDocumentsAndGlobals, configureAIAdmin } from "./plugin/admin.js"
import { createAIChangesCollection, createAITokenUsageCollection } from "./plugin/collections.js"
import { registerAIEndpoints } from "./plugin/endpoints.js"
import { resolveMaxOutputTokens, resolveMediaUploadOptions } from "./plugin/options.js"
import type { PayloadAIPluginOptions } from "./plugin/types.js"

export type { AIModelConfig, AIProviderConfig, AIProviderModelOption } from "./ai/providerOptions.js"
export type { MaxTokenUsageOptions } from "./ai/tokenUsage.js"
export type { CollectionTypeAIOptions, PayloadAIPluginOptions } from "./plugin/types.js"

export const payloadAiPlugin =
    (pluginOptions: PayloadAIPluginOptions) =>
    (config: Config): Config => {
        const incomingOnInit = config.onInit
        const collectionPermissions = resolveCollectionPermissions(pluginOptions.collections)
        const providerConfigs = resolveAIProviderConfigs(pluginOptions.providers)
        const managedProviders = providerConfigs.length > 0
        const allowUserApiKeys = !managedProviders && pluginOptions.allowUserApiKeys !== false
        const modelConfig = getResolvedAIModelConfig(pluginOptions.models)
        const maxTokenUsage = resolveMaxTokenUsageOptions(pluginOptions.maxTokenUsage)
        const mediaUploadOptions = resolveMediaUploadOptions(pluginOptions.media)
        const maxOutputTokens = resolveMaxOutputTokens(pluginOptions.maxOutputTokens)

        if (!config.collections) config.collections = []
        if (!config.collections.some((collection) => collection.slug === "payload-ai-auditlog")) {
            config.collections.push(createAIChangesCollection())
        }
        if (maxTokenUsage && !config.collections.some((collection) => collection.slug === tokenUsageCollectionSlug)) {
            config.collections.push(createAITokenUsageCollection())
        }

        if (!managedProviders) addAccountFields({ allowUserApiKeys, config })
        if (pluginOptions.disabled) return config

        const generateFields = pluginOptions.generateFields !== false
        const { textGenerationPageContexts, translationPageContexts } = addAIFieldsToDocumentsAndGlobals({
            addAIInput: pluginOptions.aiInput !== false,
            addGenerateFields: generateFields,
            addTranslation: pluginOptions.translate !== false,
            authCollections: pluginOptions.authCollections,
            config,
            uploadCollections: pluginOptions.uploadCollections,
        })
        const mentionCollectionSlugs = config.collections.flatMap((collection) => {
            if (isInternalCollection(collection.slug)) return []
            if (collectionPermissions && !collectionPermissions[collection.slug]?.read) return []
            return [collection.slug]
        })

        configureAIAdmin({
            allowUserApiKeys,
            collectionSlugs: mentionCollectionSlugs,
            config,
            managedProviders,
            mediaUploadOptions,
            modelConfig,
            providerConfigs,
        })
        registerAIEndpoints({
            allowUserApiKeys,
            collectionPermissions,
            config,
            generateFields,
            maxOutputTokens,
            maxTokenUsage,
            mediaUploadOptions,
            modelConfig,
            promptCaching: pluginOptions.promptCaching !== false,
            providerConfigs,
            textGenerationPageContexts,
            translationPageContexts,
        })

        if (incomingOnInit) {
            config.onInit = async (payload) => {
                await incomingOnInit(payload)
            }
        }

        return config
    }

import type { Config } from "payload"

import type { getResolvedAIModelConfig, ResolvedAIProviderConfig } from "../ai/providerOptions.js"
import type { ResolvedMaxTokenUsageOptions } from "../ai/tokenUsage.js"
import { createApplyActionHandler } from "../handlers/applyActionHandler.js"
import { createAuditLogHandler } from "../handlers/auditLogHandler.js"
import { createChatHandler } from "../handlers/chatHandler.js"
import { createGenerateFieldHandler } from "../handlers/generateFieldHandler.js"
import { createMediaUploadHandler, type MediaUploadOptions } from "../handlers/mediaUploadHandler.js"
import { createMentionSuggestionHandler } from "../handlers/mentionSuggestionHandler.js"
import { createProposalDiffHandler } from "../handlers/proposalDiffHandler.js"
import { createTranslateDocumentHandler } from "../handlers/translateDocumentHandler.js"
import type { ResolvedCollectionPermissionMap } from "../payload/collectionPermissions.js"
import type { TranslationPageContext } from "../payload/documentTranslation.js"
import type { TextGenerationPageContext } from "../payload/textFieldGeneration.js"

type RegisterAIEndpointsOptions = {
    allowUserApiKeys: boolean
    collectionPermissions?: ResolvedCollectionPermissionMap
    config: Config
    generateFields: boolean
    maxOutputTokens?: number
    maxTokenUsage?: ResolvedMaxTokenUsageOptions
    mediaUploadOptions: MediaUploadOptions | null
    modelConfig: ReturnType<typeof getResolvedAIModelConfig>
    promptCaching: boolean
    providerConfigs: ResolvedAIProviderConfig[]
    textGenerationPageContexts: Map<string, TextGenerationPageContext>
    translationPageContexts: Map<string, TranslationPageContext>
}

export const registerAIEndpoints = ({
    allowUserApiKeys,
    collectionPermissions,
    config,
    generateFields,
    maxOutputTokens,
    maxTokenUsage,
    mediaUploadOptions,
    modelConfig,
    promptCaching,
    providerConfigs,
    textGenerationPageContexts,
    translationPageContexts,
}: RegisterAIEndpointsOptions) => {
    if (!config.endpoints) config.endpoints = []

    config.endpoints.push(
        {
            handler: createChatHandler({
                allowUserApiKeys,
                collections: collectionPermissions,
                maxOutputTokens,
                maxTokenUsage,
                models: modelConfig,
                promptCaching,
                providers: providerConfigs,
            }),
            method: "post",
            path: "/ai-chat",
        },
        {
            handler: createApplyActionHandler({
                changeLogCollection: "payload-ai-auditlog",
                collections: collectionPermissions,
            }),
            method: "post",
            path: "/ai-apply-action",
        },
        {
            handler: createAuditLogHandler({
                changeLogCollection: "payload-ai-auditlog",
            }),
            method: "get",
            path: "/ai-audit-log",
        },
        {
            handler: createProposalDiffHandler({
                collections: collectionPermissions,
            }),
            method: "post",
            path: "/ai-proposal-diff",
        },
        {
            handler: createMentionSuggestionHandler({
                collections: collectionPermissions,
            }),
            method: "post",
            path: "/ai-mention-suggestion",
        }
    )

    if (generateFields) {
        config.endpoints.push({
            handler: createGenerateFieldHandler({
                allowUserApiKeys,
                maxOutputTokens,
                maxTokenUsage,
                models: modelConfig,
                pageContexts: textGenerationPageContexts,
                providers: providerConfigs,
            }),
            method: "post",
            path: "/ai-generate-field",
        })
    }
    if (translationPageContexts.size > 0) {
        config.endpoints.push({
            handler: createTranslateDocumentHandler({
                allowUserApiKeys,
                maxOutputTokens,
                maxTokenUsage,
                models: modelConfig,
                pageContexts: translationPageContexts,
                providers: providerConfigs,
            }),
            method: "post",
            path: "/ai-translate-document",
        })
    }
    if (mediaUploadOptions) {
        config.endpoints.push({
            handler: createMediaUploadHandler(mediaUploadOptions),
            method: "post",
            path: "/ai-upload-media",
        })
    }
}

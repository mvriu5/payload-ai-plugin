import type { AIModelConfig, AIProviderConfig } from "../ai/providerOptions.js"
import type { MaxTokenUsageOptions } from "../ai/tokenUsage.js"
import type { CollectionPermissionMap } from "../payload/collectionPermissions.js"

export type CollectionTypeAIOptions = {
    aiInput?: boolean
    generateFields?: boolean
}

export type PayloadAIPluginOptions = {
    aiInput?: boolean
    allowUserApiKeys?: boolean
    authCollections?: CollectionTypeAIOptions
    collections?: CollectionPermissionMap
    disabled?: boolean
    generateFields?: boolean
    maxOutputTokens?: number
    maxTokenUsage?: MaxTokenUsageOptions
    media?: {
        acceptedMimeTypes?: string[]
        collectionSlug?: string
        enabled?: boolean
        maxFileSize?: number
    }
    models?: AIModelConfig
    promptCaching?: boolean
    providers?: AIProviderConfig[]
    translate?: boolean
    uploadCollections?: CollectionTypeAIOptions
}

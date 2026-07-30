import type { LanguageModel } from "ai"
import type { PayloadHandler } from "payload"

import { isAIProvider, type AIModelConfig, type AIProvider, type ResolvedAIProviderConfig } from "./options.js"
import { getModel, getProviderConfig } from "./runtime.js"
import { getExceededTokenUsageLimit, recordTokenUsage, type ResolvedMaxTokenUsageOptions, type TokenUsageData, type TokenUsageLimit } from "../tokenUsage.js"

export type AIRequestOptions = {
    allowUserApiKeys?: boolean
    maxTokenUsage?: ResolvedMaxTokenUsageOptions
    models?: AIModelConfig
    providers?: ResolvedAIProviderConfig[]
}

export type AIRequestUser = {
    aiApiKey?: string | null
    aiProvider?: AIProvider | string | null
    id: number | string
}

type AIRequestFailure =
    | {
          code: "missing_api_key"
          managedProvider: boolean
          message: string
          modelID: string
          provider: AIProvider
          providerID: string
      }
    | {
          code: "token_limit"
          message: string
          tokenLimit: TokenUsageLimit
      }
    | {
          code: "unsupported_model" | "unsupported_provider"
          message: string
      }

export type AIRequestContext = {
    loadModel: () => Promise<LanguageModel>
    managedProvider: ResolvedAIProviderConfig | null
    modelID: string
    provider: AIProvider
    providerID: string
    recordUsage: (usage: TokenUsageData) => Promise<void>
}

export type AIRequestResolution =
    | {
          context: AIRequestContext
          ok: true
      }
    | {
          error: AIRequestFailure
          ok: false
      }

export const resolveAIRequestContext = async ({
    options,
    req,
    requestedModel,
    requestedProvider,
    user,
}: {
    options: AIRequestOptions
    req: Parameters<PayloadHandler>[0]
    requestedModel?: string | null
    requestedProvider?: string | null
    user: AIRequestUser
}): Promise<AIRequestResolution> => {
    const tokenLimit = await getExceededTokenUsageLimit({
        maxTokenUsage: options.maxTokenUsage,
        req,
        userID: user.id,
    })
    if (tokenLimit) {
        return {
            error: {
                code: "token_limit",
                message: "AI token usage limit reached.",
                tokenLimit,
            },
            ok: false,
        }
    }

    const managedProviders = options.providers?.length ? options.providers : null
    const providerSelection = requestedProvider || (managedProviders ? managedProviders[0].id : user.aiProvider || "openai")
    const managedProvider = managedProviders?.find((providerConfig) => providerConfig.id === providerSelection) || null

    if ((managedProviders && !managedProvider) || (!managedProvider && !isAIProvider(providerSelection))) {
        return {
            error: {
                code: "unsupported_provider",
                message: `Unsupported AI provider: ${providerSelection}`,
            },
            ok: false,
        }
    }

    const provider = (managedProvider?.provider || providerSelection) as AIProvider
    const modelSelection = requestedModel || managedProvider?.defaultModel
    if (managedProvider && modelSelection && !managedProvider.models.some((model) => model.value === modelSelection)) {
        return {
            error: {
                code: "unsupported_model",
                message: `Unsupported model "${modelSelection}" for AI provider "${managedProvider.id}".`,
            },
            ok: false,
        }
    }

    const providerConfig = getProviderConfig({
        apiKey: managedProvider ? managedProvider.apiKey : options.allowUserApiKeys === false ? null : user.aiApiKey,
        defaultModels: options.models?.defaults,
        model: modelSelection,
        provider,
    })
    const providerID = managedProvider?.id || provider
    if (!providerConfig.apiKey) {
        return {
            error: {
                code: "missing_api_key",
                managedProvider: Boolean(managedProvider),
                message: "Configure an AI provider API key first.",
                modelID: providerConfig.modelID,
                provider,
                providerID,
            },
            ok: false,
        }
    }

    return {
        context: {
            loadModel: () =>
                getModel({
                    apiKey: providerConfig.apiKey as string,
                    ...(managedProvider?.baseURL ? { baseURL: managedProvider.baseURL } : {}),
                    model: providerConfig.modelID,
                    provider,
                }),
            managedProvider,
            modelID: providerConfig.modelID,
            provider,
            providerID,
            recordUsage: async (usage) => {
                if (!options.maxTokenUsage) return
                await recordTokenUsage({
                    model: providerConfig.modelID,
                    provider: providerID,
                    req,
                    usage,
                    userID: user.id,
                })
            },
        },
        ok: true,
    }
}

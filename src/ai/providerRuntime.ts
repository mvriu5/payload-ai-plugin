import type { LanguageModel } from "ai"
import { defaultAIModels, normalizeAIProvider, type AIPluginProvider, type AIProvider, type AIModelConfig } from "./providerOptions.js"

export type CustomProviderURLConfig = string | Partial<Record<AIPluginProvider, string>>

type ProviderConfig = {
    apiKey?: string | null
    customProviderURL?: CustomProviderURLConfig
    defaultModels?: AIModelConfig["defaults"]
    model?: string | null
    provider: AIProvider
}

type ModelConfig = {
    apiKey: string
    model: string
    provider: AIProvider
    customProviderURL?: CustomProviderURLConfig
}

const getCustomProviderURL = (customProviderURL: CustomProviderURLConfig | undefined, provider: AIProvider) => {
    if (!customProviderURL) return undefined
    if (typeof customProviderURL === "string") return customProviderURL
    return customProviderURL[provider]
}

const getProviderOptions = (apiKey: string, customProviderURL: CustomProviderURLConfig | undefined, provider: AIProvider) => {
    const baseURL = getCustomProviderURL(customProviderURL, provider)

    return {
        apiKey,
        ...(baseURL ? { baseURL } : {}),
    }
}

export const getProviderConfig = ({ apiKey, customProviderURL, defaultModels, model, provider }: ProviderConfig) => {
    const defaultModel = defaultModels?.[provider] || defaultAIModels[provider]

    if (provider === "claude") {
        return {
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
            customProviderURL,
            modelID: model || process.env.ANTHROPIC_MODEL || defaultModel,
        }
    }

    if (provider === "google") {
        return {
            apiKey: apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            customProviderURL,
            modelID: model || process.env.GOOGLE_GENERATIVE_AI_MODEL || defaultModel,
        }
    }

    if (provider === "mistral") {
        return {
            apiKey: apiKey || process.env.MISTRAL_API_KEY,
            customProviderURL,
            modelID: model || process.env.MISTRAL_MODEL || defaultModel,
        }
    }

    return {
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        customProviderURL,
        modelID: model || process.env.OPENAI_MODEL || defaultModel,
    }
}

const getMissingProviderDependencyError = (packageName: string, provider: AIProvider) => {
    return new Error(`Missing optional dependency ${packageName}. Install it to use the ${provider} provider.`)
}

export const getModel = async ({ apiKey, customProviderURL, model, provider }: ModelConfig): Promise<LanguageModel> => {
    const providerOptions = getProviderOptions(apiKey, customProviderURL, normalizeAIProvider(provider))

    if (provider === "claude") {
        try {
            const { createAnthropic } = await import("@ai-sdk/anthropic")
            return createAnthropic(providerOptions)(model)
        } catch (error) {
            throw getMissingProviderDependencyError("@ai-sdk/anthropic", provider)
        }
    }

    if (provider === "google") {
        try {
            const { createGoogleGenerativeAI } = await import("@ai-sdk/google")
            return createGoogleGenerativeAI(providerOptions)(model)
        } catch (error) {
            throw getMissingProviderDependencyError("@ai-sdk/google", provider)
        }
    }

    if (provider === "mistral") {
        try {
            const { createMistral } = await import("@ai-sdk/mistral")
            return createMistral(providerOptions)(model)
        } catch (error) {
            throw getMissingProviderDependencyError("@ai-sdk/mistral", provider)
        }
    }

    try {
        const { createOpenAI } = await import("@ai-sdk/openai")
        return createOpenAI(providerOptions)(model)
    } catch (error) {
        throw getMissingProviderDependencyError("@ai-sdk/openai", provider)
    }
}

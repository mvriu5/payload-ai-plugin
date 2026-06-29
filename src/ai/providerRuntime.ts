import type { LanguageModel } from "ai"
import { defaultAIModels, type AIProvider, type AIModelConfig } from "./providerOptions.js"

type ProviderConfig = {
    apiKey?: string | null
    defaultModels?: AIModelConfig["defaults"]
    model?: string | null
    provider: AIProvider
}

type ModelConfig = {
    apiKey: string
    baseURL?: string
    model: string
    provider: AIProvider
}

export const getProviderConfig = ({ apiKey, defaultModels, model, provider }: ProviderConfig) => {
    const defaultModel = defaultModels?.[provider] || defaultAIModels[provider]

    if (provider === "claude") {
        return {
            apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
            modelID: model || process.env.ANTHROPIC_MODEL || defaultModel,
        }
    }

    if (provider === "google") {
        return {
            apiKey: apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
            modelID: model || process.env.GOOGLE_GENERATIVE_AI_MODEL || defaultModel,
        }
    }

    if (provider === "mistral") {
        return {
            apiKey: apiKey || process.env.MISTRAL_API_KEY,
            modelID: model || process.env.MISTRAL_MODEL || defaultModel,
        }
    }

    if (provider === "openrouter") {
        return {
            apiKey: apiKey || process.env.OPENROUTER_API_KEY,
            modelID: model || process.env.OPENROUTER_MODEL || defaultModel,
        }
    }

    return {
        apiKey: apiKey || process.env.OPENAI_API_KEY,
        modelID: model || process.env.OPENAI_MODEL || defaultModel,
    }
}

const getMissingProviderDependencyError = (packageName: string, provider: AIProvider) => {
    return new Error(`Missing optional dependency ${packageName}. Install it to use the ${provider} provider.`)
}

export const getModel = async ({ apiKey, baseURL, model, provider }: ModelConfig): Promise<LanguageModel> => {
    const providerOptions = {
        apiKey,
        ...(baseURL ? { baseURL } : {}),
    }

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

    if (provider === "openrouter") {
        try {
            const { createOpenRouter } = await import("@openrouter/ai-sdk-provider")
            return createOpenRouter(providerOptions)(model)
        } catch (error) {
            throw getMissingProviderDependencyError("@openrouter/ai-sdk-provider", provider)
        }
    }

    try {
        const { createOpenAI } = await import("@ai-sdk/openai")
        return createOpenAI(providerOptions)(model)
    } catch (error) {
        throw getMissingProviderDependencyError("@ai-sdk/openai", provider)
    }
}

export type AIProviderModelOption = {
    label: string
    value: string
}

const aiProviderModels = {
    claude: [
        { label: "Claude 3 Haiku", value: "claude-3-haiku-20240307" },
        { label: "Claude Sonnet 4.5", value: "claude-sonnet-4-5" },
        { label: "Claude Sonnet 4", value: "claude-sonnet-4-0" },
    ],
    google: [
        { label: "Gemini 2.0 Flash", value: "gemini-2.0-flash" },
        { label: "Gemini 2.5 Flash", value: "gemini-2.5-flash" },
        { label: "Gemini 2.5 Flash Lite", value: "gemini-2.5-flash-lite" },
        { label: "Gemini 2.5 Pro", value: "gemini-2.5-pro" },
    ],
    mistral: [
        { label: "Mistral Small", value: "mistral-small-latest" },
        { label: "Mistral Medium", value: "mistral-medium-latest" },
        { label: "Mistral Large", value: "mistral-large-latest" },
        { label: "Ministral 8B", value: "ministral-8b-latest" },
    ],
    openai: [
        { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
        { label: "GPT-4.1 Nano", value: "gpt-4.1-nano" },
        { label: "GPT-4.1", value: "gpt-4.1" },
        { label: "GPT-4o Mini", value: "gpt-4o-mini" },
    ],
    openrouter: [
        { label: "OpenRouter Auto", value: "openrouter/auto" },
        { label: "GPT-OSS-120B", value: "openai/gpt-oss-120b" },
        { label: "GPT-4o Mini", value: "openai/gpt-4o-mini" },
        { label: "Claude 3.5 Sonnet", value: "anthropic/claude-3.5-sonnet" },
        { label: "Gemini 2.0 Flash", value: "google/gemini-2.0-flash-001" },
    ],
} as const

export type AIProvider = keyof typeof aiProviderModels

type AIProviderModels = Record<AIProvider, AIProviderModelOption[]>

export type AIProviderConfig = {
    apiKey?: string
    baseURL?: string
    defaultModel?: string
    id: string
    label: string
    models: AIProviderModelOption[]
    provider: AIProvider
}

export type AIProviderProfile = {
    defaultModel: string
    id: string
    label: string
    models: AIProviderModelOption[]
    provider: AIProvider
}

export type ResolvedAIProviderConfig = AIProviderProfile & {
    apiKey?: string
    baseURL?: string
}

export const aiProviders: { label: string; value: AIProvider }[] = [
    { label: "Claude", value: "claude" },
    { label: "Google Gemini", value: "google" },
    { label: "Mistral", value: "mistral" },
    { label: "OpenAI", value: "openai" },
    { label: "OpenRouter", value: "openrouter" },
]

export const defaultAIModels: Record<AIProvider, string> = {
    claude: aiProviderModels.claude[0].value,
    google: aiProviderModels.google[0].value,
    mistral: aiProviderModels.mistral[0].value,
    openai: aiProviderModels.openai[0].value,
    openrouter: aiProviderModels.openrouter[0].value,
}

export type AIModelConfig = {
    defaults?: Partial<Record<AIProvider, string>>
    providers?: Partial<Record<AIProvider, AIProviderModelOption[]>>
}

export const getResolvedAIModelConfig = (modelConfig?: AIModelConfig) => {
    const providers = Object.fromEntries(
        Object.entries(aiProviderModels).map(([provider, models]) => {
            const providerKey = provider as AIProvider

            return [provider, modelConfig?.providers?.[providerKey] || [...models]]
        })
    ) as AIProviderModels

    const defaults = Object.fromEntries(
        Object.entries(defaultAIModels).map(([provider, defaultModel]) => {
            const providerKey = provider as AIProvider
            const configuredDefault = modelConfig?.defaults?.[providerKey]
            const providerModels = providers[providerKey]

            return [provider, configuredDefault || providerModels[0]?.value || defaultModel]
        })
    ) as Record<AIProvider, string>

    return {
        defaults,
        providers,
    }
}

export const isAIProvider = (provider: string): provider is AIProvider => provider in aiProviderModels

export const getLegacyAIProviderProfiles = (modelConfig?: AIModelConfig): AIProviderProfile[] => {
    const resolvedModels = getResolvedAIModelConfig(modelConfig)

    return aiProviders.map(({ label, value }) => ({
        defaultModel: resolvedModels.defaults[value],
        id: value,
        label,
        models: resolvedModels.providers[value],
        provider: value,
    }))
}

export const resolveAIProviderConfigs = (providers?: AIProviderConfig[]): ResolvedAIProviderConfig[] => {
    if (!providers?.length) return []

    const providerIDs = new Set<string>()

    return providers.map((providerConfig, index) => {
        const path = `providers[${index}]`
        const id = providerConfig.id.trim()
        const label = providerConfig.label.trim()

        if (!id || !/^[a-z0-9][a-z0-9_-]*$/i.test(id)) {
            throw new Error(`${path}.id must contain only letters, numbers, hyphens, or underscores.`)
        }
        if (providerIDs.has(id)) throw new Error(`Duplicate AI provider id: ${id}`)
        providerIDs.add(id)

        if (!label) throw new Error(`${path}.label is required.`)
        if (!isAIProvider(providerConfig.provider)) {
            throw new Error(`${path}.provider is unsupported: ${String(providerConfig.provider)}`)
        }
        if (!providerConfig.models.length) throw new Error(`${path}.models must contain at least one model.`)

        const modelValues = new Set<string>()
        const models = providerConfig.models.map((model, modelIndex) => {
            const modelPath = `${path}.models[${modelIndex}]`
            const modelLabel = model.label.trim()
            const value = model.value.trim()

            if (!modelLabel) throw new Error(`${modelPath}.label is required.`)
            if (!value) throw new Error(`${modelPath}.value is required.`)
            if (modelValues.has(value)) throw new Error(`Duplicate model value "${value}" in AI provider "${id}".`)
            modelValues.add(value)

            return {
                label: modelLabel,
                value,
            }
        })
        const defaultModel = providerConfig.defaultModel?.trim() || models[0].value

        if (!modelValues.has(defaultModel)) {
            throw new Error(`${path}.defaultModel must match a configured model value.`)
        }

        if (providerConfig.baseURL) {
            let parsedURL: URL

            try {
                parsedURL = new URL(providerConfig.baseURL)
            } catch {
                throw new Error(`${path}.baseURL must be a valid URL.`)
            }

            if (!["http:", "https:"].includes(parsedURL.protocol)) {
                throw new Error(`${path}.baseURL must use http or https.`)
            }
        }

        return {
            ...(providerConfig.apiKey ? { apiKey: providerConfig.apiKey } : {}),
            ...(providerConfig.baseURL ? { baseURL: providerConfig.baseURL } : {}),
            defaultModel,
            id,
            label,
            models,
            provider: providerConfig.provider,
        }
    })
}

export const toClientAIProviderProfiles = (providers: ResolvedAIProviderConfig[]): AIProviderProfile[] =>
    providers.map(({ defaultModel, id, label, models, provider }) => ({
        defaultModel,
        id,
        label,
        models,
        provider,
    }))

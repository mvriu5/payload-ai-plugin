export type AIProviderModelOption = {
    label: string
    value: string
}

// Current and older text models for the streaming tool loop, checked against provider catalogs on 2026-10-06.
// The first model for each provider is its default. Retired direct API models are excluded;
// OpenRouter has its own catalog and may still serve models retired by their original provider.
const aiProviderModels = {
    claude: [
        { label: "Claude Haiku 4.5", value: "claude-haiku-4-5" },
        { label: "Claude Sonnet 5.5", value: "claude-sonnet-5-5" },
        { label: "Claude Opus 5.5", value: "claude-opus-5-5" },
        { label: "Claude Fable 5.1", value: "claude-fable-5-1" },
        { label: "Claude Fable 5", value: "claude-fable-5" },
        { label: "Claude Sonnet 5", value: "claude-sonnet-5" },
        { label: "Claude Opus 5", value: "claude-opus-5" },
        { label: "Claude Opus 4.8", value: "claude-opus-4-8" },
        { label: "Claude Opus 4.7", value: "claude-opus-4-7" },
        { label: "Claude Sonnet 4.6", value: "claude-sonnet-4-6" },
        { label: "Claude Opus 4.6", value: "claude-opus-4-6" },
        { label: "Claude Sonnet 4.5 (Deprecated)", value: "claude-sonnet-4-5" },
        { label: "Claude Opus 4.5", value: "claude-opus-4-5" },
    ],
    google: [
        { label: "Gemini 3.8 Flash", value: "gemini-3.8-flash" },
        { label: "Gemini 3.5 Flash Lite", value: "gemini-3.5-flash-lite" },
        { label: "Gemini 3.1 Pro (Preview)", value: "gemini-3.1-pro-preview" },
        { label: "Gemini 3.7 Flash", value: "gemini-3.7-flash" },
        { label: "Gemini 3.6 Flash", value: "gemini-3.6-flash" },
        { label: "Gemini 3.5 Flash", value: "gemini-3.5-flash" },
        { label: "Gemini 3.1 Flash Lite", value: "gemini-3.1-flash-lite" },
        { label: "Gemini 3.1 Pro Custom Tools (Preview)", value: "gemini-3.1-pro-preview-customtools" },
        { label: "Gemini 3 Flash (Preview)", value: "gemini-3-flash-preview" },
        { label: "Gemini 2.5 Flash (Legacy)", value: "gemini-2.5-flash" },
        { label: "Gemini 2.5 Flash Lite (Legacy)", value: "gemini-2.5-flash-lite" },
        { label: "Gemini 2.5 Pro (Legacy)", value: "gemini-2.5-pro" },
    ],
    mistral: [
        { label: "Mistral Small 4", value: "mistral-small-2603" },
        { label: "Mistral Medium 3.5", value: "mistral-medium-3-5" },
        { label: "Mistral Large 3", value: "mistral-large-2512" },
        { label: "Mistral Large 4 (Preview)", value: "mistral-large-4" },
        { label: "Ministral 3 8B", value: "ministral-8b-2512" },
        { label: "Ministral 3 14B", value: "ministral-14b-2512" },
        { label: "Ministral 3 3B", value: "ministral-3b-2512" },
        { label: "Codestral", value: "codestral-2508" },
        { label: "Mistral Medium 3.1 (Deprecated)", value: "mistral-medium-2508" },
        { label: "Mistral Medium 3 (Deprecated)", value: "mistral-medium-2505" },
        { label: "Mistral Small 3.2 (Deprecated)", value: "mistral-small-2506" },
        { label: "Mistral Large 2.1 (Deprecated)", value: "mistral-large-2411" },
        { label: "Pixtral Large (Deprecated)", value: "pixtral-large-2411" },
        { label: "Pixtral 12B (Deprecated)", value: "pixtral-12b-2409" },
        { label: "Mistral Nemo 12B (Deprecated)", value: "open-mistral-nemo-2407" },
        { label: "Magistral Medium 1.2 (Deprecated)", value: "magistral-medium-2509" },
        { label: "Magistral Small 1.2 (Deprecated)", value: "magistral-small-2509" },
        { label: "Devstral 2 (Deprecated)", value: "devstral-2512" },
        { label: "Devstral Small 2 (Deprecated)", value: "labs-devstral-small-2512" },
        { label: "Mistral Small Creative (Deprecated)", value: "labs-mistral-small-creative" },
    ],
    openai: [
        { label: "GPT-6 Luna", value: "gpt-6-luna" },
        { label: "GPT-6.1 Sol", value: "gpt-6.1-sol" },
        { label: "GPT-6 Astra", value: "gpt-6-astra" },
        { label: "GPT-6 Sol", value: "gpt-6-sol" },
        { label: "GPT-5.6 Luna", value: "gpt-5.6-luna" },
        { label: "GPT-5.6 Terra", value: "gpt-5.6-terra" },
        { label: "GPT-5.6 Sol", value: "gpt-5.6-sol" },
        { label: "GPT-5.5", value: "gpt-5.5" },
        { label: "GPT-5.4", value: "gpt-5.4" },
        { label: "GPT-5.4 Pro", value: "gpt-5.4-pro" },
        { label: "GPT-5.4 Mini", value: "gpt-5.4-mini" },
        { label: "GPT-5.4 Nano (Deprecated)", value: "gpt-5.4-nano" },
        { label: "GPT-5.3 Codex (Deprecated)", value: "gpt-5.3-codex" },
        { label: "GPT-5.2", value: "gpt-5.2" },
        { label: "GPT-5.2 Pro", value: "gpt-5.2-pro" },
        { label: "GPT-5.1 (Deprecated)", value: "gpt-5.1" },
        { label: "GPT-5", value: "gpt-5" },
        { label: "GPT-5 Pro", value: "gpt-5-pro" },
        { label: "GPT-5 Mini", value: "gpt-5-mini" },
        { label: "GPT-5 Nano", value: "gpt-5-nano" },
        { label: "GPT-4.1", value: "gpt-4.1" },
        { label: "GPT-4.1 Mini", value: "gpt-4.1-mini" },
        { label: "GPT-4.1 Nano (Deprecated)", value: "gpt-4.1-nano" },
        { label: "GPT-4o", value: "gpt-4o" },
        { label: "GPT-4o Mini", value: "gpt-4o-mini" },
        { label: "o3", value: "o3" },
        { label: "o3 Mini (Deprecated)", value: "o3-mini" },
        { label: "o4 Mini (Deprecated)", value: "o4-mini" },
        { label: "o1 (Deprecated)", value: "o1" },
    ],
    openrouter: [
        { label: "OpenRouter Auto", value: "openrouter/auto" },
        { label: "GPT-6 Luna", value: "openai/gpt-6-luna" },
        { label: "GPT-6.1 Sol", value: "openai/gpt-6.1-sol" },
        { label: "GPT-6 Astra", value: "openai/gpt-6-astra" },
        { label: "Claude Haiku 4.5", value: "anthropic/claude-haiku-4.5" },
        { label: "Claude Sonnet 5.5", value: "anthropic/claude-sonnet-5.5" },
        { label: "Claude Opus 5.5", value: "anthropic/claude-opus-5.5" },
        { label: "Gemini 3.8 Flash", value: "google/gemini-3.8-flash" },
        { label: "GPT-OSS-120B", value: "openai/gpt-oss-120b" },
        // OpenAI: older generations and open-weight models.
        { label: "GPT-6 Sol", value: "openai/gpt-6-sol" },
        { label: "GPT-5.6 Luna", value: "openai/gpt-5.6-luna" },
        { label: "GPT-5.6 Terra", value: "openai/gpt-5.6-terra" },
        { label: "GPT-5.6 Sol", value: "openai/gpt-5.6-sol" },
        { label: "GPT-5.5", value: "openai/gpt-5.5" },
        { label: "GPT-5.4", value: "openai/gpt-5.4" },
        { label: "GPT-5.4 Pro", value: "openai/gpt-5.4-pro" },
        { label: "GPT-5.4 Mini", value: "openai/gpt-5.4-mini" },
        { label: "GPT-5.4 Nano", value: "openai/gpt-5.4-nano" },
        { label: "GPT-5.3 Codex", value: "openai/gpt-5.3-codex" },
        { label: "GPT-5.2", value: "openai/gpt-5.2" },
        { label: "GPT-5.2 Pro", value: "openai/gpt-5.2-pro" },
        { label: "GPT-5.1", value: "openai/gpt-5.1" },
        { label: "GPT-5", value: "openai/gpt-5" },
        { label: "GPT-5 Pro", value: "openai/gpt-5-pro" },
        { label: "GPT-5 Mini", value: "openai/gpt-5-mini" },
        { label: "GPT-5 Nano", value: "openai/gpt-5-nano" },
        { label: "GPT-4.1", value: "openai/gpt-4.1" },
        { label: "GPT-4.1 Mini", value: "openai/gpt-4.1-mini" },
        { label: "GPT-4.1 Nano", value: "openai/gpt-4.1-nano" },
        { label: "GPT-4o", value: "openai/gpt-4o" },
        { label: "GPT-4o Mini", value: "openai/gpt-4o-mini" },
        { label: "GPT-4 Turbo", value: "openai/gpt-4-turbo" },
        { label: "GPT-4", value: "openai/gpt-4" },
        { label: "GPT-3.5 Turbo", value: "openai/gpt-3.5-turbo" },
        { label: "o3", value: "openai/o3" },
        { label: "o3 Mini", value: "openai/o3-mini" },
        { label: "o4 Mini", value: "openai/o4-mini" },
        { label: "o1", value: "openai/o1" },
        { label: "GPT-OSS-20B", value: "openai/gpt-oss-20b" },
        // Anthropic: OpenRouter model IDs use dots rather than the direct API's hyphens.
        { label: "Claude Fable 5.1", value: "anthropic/claude-fable-5.1" },
        { label: "Claude Fable 5", value: "anthropic/claude-fable-5" },
        { label: "Claude Sonnet 5", value: "anthropic/claude-sonnet-5" },
        { label: "Claude Opus 5", value: "anthropic/claude-opus-5" },
        { label: "Claude Opus 4.8", value: "anthropic/claude-opus-4.8" },
        { label: "Claude Opus 4.7", value: "anthropic/claude-opus-4.7" },
        { label: "Claude Sonnet 4.6", value: "anthropic/claude-sonnet-4.6" },
        { label: "Claude Opus 4.6", value: "anthropic/claude-opus-4.6" },
        { label: "Claude Sonnet 4.5", value: "anthropic/claude-sonnet-4.5" },
        { label: "Claude Opus 4.5", value: "anthropic/claude-opus-4.5" },
        { label: "Claude Opus 4.1", value: "anthropic/claude-opus-4.1" },
        { label: "Claude Sonnet 4", value: "anthropic/claude-sonnet-4" },
        // Google.
        { label: "Gemini 3.7 Flash", value: "google/gemini-3.7-flash" },
        { label: "Gemini 3.6 Flash", value: "google/gemini-3.6-flash" },
        { label: "Gemini 3.5 Flash", value: "google/gemini-3.5-flash" },
        { label: "Gemini 3.5 Flash Lite", value: "google/gemini-3.5-flash-lite" },
        { label: "Gemini 3.1 Flash Lite", value: "google/gemini-3.1-flash-lite" },
        { label: "Gemini 3.1 Pro (Preview)", value: "google/gemini-3.1-pro-preview" },
        { label: "Gemini 3.1 Pro Custom Tools (Preview)", value: "google/gemini-3.1-pro-preview-customtools" },
        { label: "Gemini 3 Flash (Preview)", value: "google/gemini-3-flash-preview" },
        { label: "Gemini 2.5 Flash", value: "google/gemini-2.5-flash" },
        { label: "Gemini 2.5 Flash Lite", value: "google/gemini-2.5-flash-lite" },
        { label: "Gemini 2.5 Pro", value: "google/gemini-2.5-pro" },
        // Mistral.
        { label: "Mistral Large 4 (Preview)", value: "mistralai/mistral-large-4-0" },
        { label: "Mistral Small 4", value: "mistralai/mistral-small-2603" },
        { label: "Mistral Medium 3.5", value: "mistralai/mistral-medium-3-5" },
        { label: "Mistral Large 3", value: "mistralai/mistral-large-2512" },
        { label: "Ministral 3 14B", value: "mistralai/ministral-14b-2512" },
        { label: "Ministral 3 8B", value: "mistralai/ministral-8b-2512" },
        { label: "Ministral 3 3B", value: "mistralai/ministral-3b-2512" },
        { label: "Mistral Medium 3.1", value: "mistralai/mistral-medium-3.1" },
        { label: "Mistral Medium 3", value: "mistralai/mistral-medium-3" },
        { label: "Mistral Small 3.2 24B", value: "mistralai/mistral-small-3.2-24b-instruct" },
        { label: "Mistral Small 3.1 24B", value: "mistralai/mistral-small-3.1-24b-instruct" },
        { label: "Mistral Large", value: "mistralai/mistral-large" },
        { label: "Mistral Nemo", value: "mistralai/mistral-nemo" },
        { label: "Mixtral 8x22B Instruct", value: "mistralai/mixtral-8x22b-instruct" },
        { label: "Codestral", value: "mistralai/codestral-2508" },
        { label: "Devstral 2", value: "mistralai/devstral-2512" },
        // Additional tool-capable models available through OpenRouter.
        { label: "DeepSeek V4.1 Flash", value: "deepseek/deepseek-v4.1-flash" },
        { label: "DeepSeek V4 Pro", value: "deepseek/deepseek-v4-pro" },
        { label: "DeepSeek V4 Flash", value: "deepseek/deepseek-v4-flash" },
        { label: "DeepSeek V3.2", value: "deepseek/deepseek-v3.2" },
        { label: "DeepSeek V3.1 Terminus", value: "deepseek/deepseek-v3.1-terminus" },
        { label: "DeepSeek V3.1", value: "deepseek/deepseek-chat-v3.1" },
        { label: "DeepSeek V3", value: "deepseek/deepseek-chat" },
        { label: "DeepSeek R1", value: "deepseek/deepseek-r1" },
        { label: "DeepSeek R1 (0528)", value: "deepseek/deepseek-r1-0528" },
        { label: "Qwen3.8 Max", value: "qwen/qwen3.8-max-0902" },
        { label: "Qwen3.8 Flash", value: "qwen/qwen3.8-flash" },
        { label: "Qwen3.7 Max", value: "qwen/qwen3.7-max" },
        { label: "Qwen3.7 Plus", value: "qwen/qwen3.7-plus" },
        { label: "Qwen3.7 Flash", value: "qwen/qwen3.7-flash" },
        { label: "Qwen3.6 Plus", value: "qwen/qwen3.6-plus" },
        { label: "Qwen3.6 Flash", value: "qwen/qwen3.6-flash" },
        { label: "Qwen3.5 397B A17B", value: "qwen/qwen3.5-397b-a17b" },
        { label: "Qwen3.5 35B A3B", value: "qwen/qwen3.5-35b-a3b" },
        { label: "Qwen3 Max", value: "qwen/qwen3-max" },
        { label: "Qwen3 Coder", value: "qwen/qwen3-coder" },
        { label: "Qwen3 Coder Next", value: "qwen/qwen3-coder-next" },
        { label: "Qwen3 235B A22B", value: "qwen/qwen3-235b-a22b" },
        { label: "Qwen3 32B", value: "qwen/qwen3-32b" },
        { label: "Qwen3 14B", value: "qwen/qwen3-14b" },
        { label: "Qwen3 8B", value: "qwen/qwen3-8b" },
        { label: "Qwen2.5 72B Instruct", value: "qwen/qwen-2.5-72b-instruct" },
        { label: "Grok 4.7", value: "x-ai/grok-4.7" },
        { label: "Grok 4.6", value: "x-ai/grok-4.6" },
        { label: "Grok 4.5", value: "x-ai/grok-4.5" },
        { label: "Grok 4.3", value: "x-ai/grok-4.3" },
        { label: "Grok 4.20", value: "x-ai/grok-4.20" },
        { label: "Llama 4 Maverick", value: "meta-llama/llama-4-maverick" },
        { label: "Llama 4 Scout", value: "meta-llama/llama-4-scout" },
        { label: "Llama 3.3 70B Instruct", value: "meta-llama/llama-3.3-70b-instruct" },
        { label: "Llama 3.1 70B Instruct", value: "meta-llama/llama-3.1-70b-instruct" },
        { label: "Llama 3.1 8B Instruct", value: "meta-llama/llama-3.1-8b-instruct" },
        { label: "GLM 5.3", value: "z-ai/glm-5.3" },
        { label: "GLM 5.3 Flash", value: "z-ai/glm-5.3-flash" },
        { label: "GLM 5.2", value: "z-ai/glm-5.2" },
        { label: "GLM 5.1", value: "z-ai/glm-5.1" },
        { label: "GLM 5", value: "z-ai/glm-5" },
        { label: "GLM 4.7", value: "z-ai/glm-4.7" },
        { label: "GLM 4.7 Flash", value: "z-ai/glm-4.7-flash" },
        { label: "GLM 4.6", value: "z-ai/glm-4.6" },
        { label: "GLM 4.5", value: "z-ai/glm-4.5" },
        { label: "GLM 4.5 Air", value: "z-ai/glm-4.5-air" },
        { label: "Kimi K3", value: "moonshotai/kimi-k3" },
        { label: "Kimi K2.7 Code", value: "moonshotai/kimi-k2.7-code" },
        { label: "Kimi K2.6", value: "moonshotai/kimi-k2.6" },
        { label: "Kimi K2.5", value: "moonshotai/kimi-k2.5" },
        { label: "Kimi K2 Thinking", value: "moonshotai/kimi-k2-thinking" },
        { label: "Kimi K2", value: "moonshotai/kimi-k2" },
        { label: "MiniMax M3", value: "minimax/minimax-m3" },
        { label: "MiniMax M2.7", value: "minimax/minimax-m2.7" },
        { label: "MiniMax M2.5", value: "minimax/minimax-m2.5" },
        { label: "MiniMax M2.1", value: "minimax/minimax-m2.1" },
        { label: "MiniMax M2", value: "minimax/minimax-m2" },
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

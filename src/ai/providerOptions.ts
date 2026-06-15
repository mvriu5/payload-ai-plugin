type AIProviderModelOption = {
  label: string;
  value: string;
};

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
  groq: [
    { label: "Llama 3.3 70B Versatile", value: "llama-3.3-70b-versatile" },
    { label: "Llama 3.1 8B Instant", value: "llama-3.1-8b-instant" },
    { label: "GPT OSS 120B", value: "openai/gpt-oss-120b" },
    { label: "GPT OSS 20B", value: "openai/gpt-oss-20b" },
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
} as const;

export type AIProvider = keyof typeof aiProviderModels;

type AIProviderModels = Record<AIProvider, AIProviderModelOption[]>;

export const aiProviders: { label: string; value: AIProvider }[] = [
  { label: "Claude", value: "claude" },
  { label: "Google Gemini", value: "google" },
  { label: "Groq", value: "groq" },
  { label: "Mistral", value: "mistral" },
  { label: "OpenAI", value: "openai" },
];

export const defaultAIModels: Record<AIProvider, string> = {
  claude: aiProviderModels.claude[0].value,
  google: aiProviderModels.google[0].value,
  groq: aiProviderModels.groq[0].value,
  mistral: aiProviderModels.mistral[0].value,
  openai: aiProviderModels.openai[0].value,
};

export type AIModelConfig = {
  defaults?: Partial<Record<AIProvider, string>>;
  providers?: Partial<Record<AIProvider, AIProviderModelOption[]>>;
};

export const getResolvedAIModelConfig = (modelConfig?: AIModelConfig) => {
  const providers = Object.fromEntries(
    Object.entries(aiProviderModels).map(([provider, models]) => [
      provider,
      modelConfig?.providers?.[provider as AIProvider] || [...models],
    ]),
  ) as AIProviderModels;

  const defaults = Object.fromEntries(
    Object.entries(defaultAIModels).map(([provider, defaultModel]) => {
      const providerKey = provider as AIProvider;
      const configuredDefault = modelConfig?.defaults?.[providerKey];
      const providerModels = providers[providerKey];

      return [
        provider,
        configuredDefault || providerModels[0]?.value || defaultModel,
      ];
    }),
  ) as Record<AIProvider, string>;

  return {
    defaults,
    providers,
  };
};

export const isAIProvider = (provider: string): provider is AIProvider => {
  return provider in aiProviderModels;
};

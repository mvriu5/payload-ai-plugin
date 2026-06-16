import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import { defaultAIModels, type AIProvider } from "./providerOptions.js";

type ProviderConfig = {
  apiKey?: string | null;
  model?: string | null;
  provider: AIProvider;
};

type ModelConfig = {
  apiKey: string;
  model: string;
  provider: AIProvider;
};

export const getProviderConfig = ({
  apiKey,
  model,
  provider,
}: ProviderConfig) => {
  if (provider === "claude") {
    return {
      apiKey: apiKey || process.env.ANTHROPIC_API_KEY,
      modelID: model || process.env.ANTHROPIC_MODEL || defaultAIModels.claude,
    };
  }

  if (provider === "google") {
    return {
      apiKey: apiKey || process.env.GOOGLE_GENERATIVE_AI_API_KEY,
      modelID:
        model ||
        process.env.GOOGLE_GENERATIVE_AI_MODEL ||
        defaultAIModels.google,
    };
  }

  if (provider === "mistral") {
    return {
      apiKey: apiKey || process.env.MISTRAL_API_KEY,
      modelID: model || process.env.MISTRAL_MODEL || defaultAIModels.mistral,
    };
  }

  return {
    apiKey: apiKey || process.env.OPENAI_API_KEY,
    modelID: model || process.env.OPENAI_MODEL || defaultAIModels.openai,
  };
};

export const getModel = ({ apiKey, model, provider }: ModelConfig): LanguageModel => {
  if (provider === "claude") return createAnthropic({ apiKey })(model);
  if (provider === "google") return createGoogleGenerativeAI({ apiKey })(model);
  if (provider === "mistral") return createMistral({ apiKey })(model);
  return createOpenAI({ apiKey })(model);
};

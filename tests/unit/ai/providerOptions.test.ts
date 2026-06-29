import { describe, expect, it } from "vitest"

import { resolveAIProviderConfigs, toClientAIProviderProfiles } from "../../../src/ai/providerOptions.js"

describe("AI provider options", () => {
    it("resolves managed provider defaults and strips server settings from client profiles", () => {
        const providers = resolveAIProviderConfigs([
            {
                apiKey: "secret",
                baseURL: "http://localhost:11434/v1",
                id: "ollama",
                label: "Ollama",
                models: [{ label: "Llama 3.3", value: "llama3.3" }],
                provider: "openai",
            },
        ])

        expect(providers[0]).toMatchObject({
            apiKey: "secret",
            baseURL: "http://localhost:11434/v1",
            defaultModel: "llama3.3",
        })
        expect(toClientAIProviderProfiles(providers)).toEqual([
            {
                defaultModel: "llama3.3",
                id: "ollama",
                label: "Ollama",
                models: [{ label: "Llama 3.3", value: "llama3.3" }],
                provider: "openai",
            },
        ])
    })

    it("rejects duplicate provider ids and invalid default models", () => {
        expect(() =>
            resolveAIProviderConfigs([
                {
                    id: "custom",
                    label: "First",
                    models: [{ label: "Model", value: "model" }],
                    provider: "openai",
                },
                {
                    id: "custom",
                    label: "Second",
                    models: [{ label: "Model", value: "model" }],
                    provider: "openai",
                },
            ])
        ).toThrow("Duplicate AI provider id: custom")

        expect(() =>
            resolveAIProviderConfigs([
                {
                    defaultModel: "missing",
                    id: "custom",
                    label: "Custom",
                    models: [{ label: "Model", value: "model" }],
                    provider: "openai",
                },
            ])
        ).toThrow("defaultModel must match a configured model value")
    })
})

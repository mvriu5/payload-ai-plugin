// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AIProviderProfile } from "../../src/ai/providerOptions.js"
import { useAISettings } from "../../src/components/hooks/useAISettings.js"
import { installLocalStorageMock } from "../fixtures/localStorage.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const providerProfiles: AIProviderProfile[] = [
    {
        defaultModel: "openai-default",
        id: "openai",
        label: "OpenAI",
        models: [
            { label: "OpenAI default", value: "openai-default" },
            { label: "OpenAI custom", value: "openai-custom" },
        ],
        provider: "openai",
    },
    {
        defaultModel: "openrouter-default",
        id: "openrouter",
        label: "OpenRouter",
        models: [
            { label: "OpenRouter default", value: "openrouter-default" },
            { label: "OpenRouter custom", value: "openrouter-custom" },
        ],
        provider: "openrouter",
    },
]

const managedProviderProfiles: AIProviderProfile[] = [
    {
        defaultModel: "gpt-test",
        id: "company-openai",
        label: "Company OpenAI",
        models: [{ label: "GPT Test", value: "gpt-test" }],
        provider: "openai",
    },
    {
        defaultModel: "llama3.3",
        id: "ollama",
        label: "Ollama",
        models: [
            { label: "Llama 3.3", value: "llama3.3" },
            { label: "Qwen 3", value: "qwen3" },
        ],
        provider: "openai",
    },
]

const flushPromises = async () => {
    await act(async () => {
        await Promise.resolve()
    })
}

const HookTest = ({
    managedProviders = false,
    profiles = providerProfiles,
    provider,
}: {
    managedProviders?: boolean
    profiles?: AIProviderProfile[]
    provider?: string
}) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
            user: {
                aiProvider: provider,
            },
        }),
        ok: true,
    }) as never

    const { selectedModel, setSelectedModel, setSelectedProviderModel, settingsProvider } = useAISettings({
        adminUserSlug: "users",
        apiRoute: "/api",
        managedProviders,
        providerProfiles: profiles,
    })

    return (
        <div>
            <span data-testid="provider">{settingsProvider || ""}</span>
            <span data-testid="model">{selectedModel}</span>
            <button onClick={() => setSelectedModel(`${settingsProvider}-custom`)} type="button">
                Select custom
            </button>
            <button onClick={() => setSelectedProviderModel("ollama", "qwen3")} type="button">
                Select managed
            </button>
        </div>
    )
}

describe("useAISettings", () => {
    beforeEach(() => {
        installLocalStorageMock()
        window.localStorage.clear()
    })

    afterEach(() => {
        cleanupRoots()
        vi.restoreAllMocks()
        window.localStorage.clear()
    })

    it("uses provider defaults when no stored model exists", async () => {
        const { container } = render(<HookTest provider="openai" />)

        await flushPromises()

        expect(container.querySelector('[data-testid="provider"]')?.textContent).toBe("openai")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("openai-default")
    })

    it("stores selected models per provider", async () => {
        const { container, rerender } = render(<HookTest key="openai" provider="openai" />)

        await flushPromises()
        act(() => {
            container.querySelectorAll("button")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(window.localStorage.getItem("payload-ai:selected-model:openai")).toBe("openai-custom")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("openai-custom")

        rerender(<HookTest key="openrouter" provider="openrouter" />)
        await flushPromises()
        act(() => {
            container.querySelectorAll("button")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(window.localStorage.getItem("payload-ai:selected-model:openrouter")).toBe("openrouter-custom")

        rerender(<HookTest key="openai-again" provider="openai" />)
        await flushPromises()

        expect(container.querySelector('[data-testid="provider"]')?.textContent).toBe("openai")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("openai-custom")
    })

    it("clears settings when the user provider is unsupported", async () => {
        const { container } = render(<HookTest provider="unknown" />)

        await flushPromises()

        expect(container.querySelector('[data-testid="provider"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("")
    })

    it("uses configured providers without loading user settings", async () => {
        const { container } = render(<HookTest managedProviders profiles={managedProviderProfiles} />)

        await flushPromises()

        expect(globalThis.fetch).not.toHaveBeenCalled()
        expect(container.querySelector('[data-testid="provider"]')?.textContent).toBe("company-openai")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("gpt-test")

        act(() => {
            container.querySelectorAll("button")[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="provider"]')?.textContent).toBe("ollama")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("qwen3")
        expect(JSON.parse(window.localStorage.getItem("payload-ai:selected-managed-model") || "null")).toEqual({
            model: "qwen3",
            provider: "ollama",
        })
    })
})

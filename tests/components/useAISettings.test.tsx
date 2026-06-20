// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { AIProvider } from "../../src/ai/providerOptions.js"
import { useAISettings } from "../../src/components/hooks/useAISettings.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const defaultModels: Record<AIProvider, string> = {
    claude: "claude-default",
    google: "google-default",
    mistral: "mistral-default",
    openai: "openai-default",
    openrouter: "openrouter-default",
}

const flushPromises = async () => {
    await act(async () => {
        await Promise.resolve()
    })
}

const installLocalStorageMock = () => {
    const store = new Map<string, string>()

    Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
            clear: vi.fn(() => store.clear()),
            getItem: vi.fn((key: string) => store.get(key) ?? null),
            removeItem: vi.fn((key: string) => store.delete(key)),
            setItem: vi.fn((key: string, value: string) => store.set(key, value)),
        },
    })
}

const HookTest = ({ provider }: { provider: string }) => {
    globalThis.fetch = vi.fn().mockResolvedValue({
        json: vi.fn().mockResolvedValue({
            user: {
                aiProvider: provider,
            },
        }),
        ok: true,
    }) as never

    const { selectedModel, setSelectedModel, settingsProvider } = useAISettings({
        adminUserSlug: "users",
        apiRoute: "/api",
        defaultModels,
    })

    return (
        <div>
            <span data-testid="provider">{settingsProvider || ""}</span>
            <span data-testid="model">{selectedModel}</span>
            <button onClick={() => setSelectedModel(`${settingsProvider}-custom`)} type="button">
                Select custom
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
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(window.localStorage.getItem("payload-ai:selected-model:openai")).toBe("openai-custom")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("openai-custom")

        rerender(<HookTest key="openrouter" provider="openrouter" />)
        await flushPromises()
        act(() => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(window.localStorage.getItem("payload-ai:selected-model:openrouter")).toBe("openrouter-custom")

        rerender(<HookTest key="openai-again" provider="openai" />)
        await flushPromises()

        expect(container.querySelector('[data-testid="provider"]')?.textContent).toBe("openai")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("openai-custom")
    })

    it("clears settings when the provider is unsupported", async () => {
        const { container } = render(<HookTest provider="unknown" />)

        await flushPromises()

        expect(container.querySelector('[data-testid="provider"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="model"]')?.textContent).toBe("")
    })
})

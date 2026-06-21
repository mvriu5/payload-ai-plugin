// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import AIInput from "../../src/components/AIInput.js"
import { adminConfig } from "../fixtures/payloadConfig.js"
import { createJSONResponse, createStreamResponse, installFetchMock } from "../fixtures/fetch.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockSetSelectedModel = vi.hoisted(() => vi.fn())
const mockUseAISettings = vi.hoisted(() => vi.fn())
const mockUseDocumentMentionSuggestions = vi.hoisted(() => vi.fn())

vi.mock("@payloadcms/ui", () => ({
    useConfig: mockUseConfig,
}))

vi.mock("../../src/components/hooks/useAISettings.js", () => ({
    useAISettings: mockUseAISettings,
}))

vi.mock("../../src/components/hooks/useDocumentMentionSuggestions.js", () => ({
    useDocumentMentionSuggestions: mockUseDocumentMentionSuggestions,
}))

vi.mock("../../src/components/ActionToast.js", () => ({
    ActionToast: ({ description, error, proposals }: { description?: string; error?: string; proposals: unknown[] }) => (
        <div data-testid="action-toast">
            <span data-testid="toast-description">{description || ""}</span>
            <span data-testid="toast-error">{error || ""}</span>
            <span data-testid="toast-proposals">{proposals.length}</span>
        </div>
    ),
}))

vi.mock("../../src/components/AuditLogList.js", () => ({
    RecentChangesList: ({ allChangesURL, changes }: { allChangesURL?: string; changes: unknown[] }) => (
        <aside data-all-url={allChangesURL} data-testid="recent-changes">
            {changes.length}
        </aside>
    ),
}))

const flushPromises = async () => {
    await act(async () => {
        await Promise.resolve()
    })
}

describe("AIInput", () => {
    beforeEach(() => {
        mockUseConfig.mockReturnValue({ config: adminConfig })
        mockUseAISettings.mockReturnValue({
            selectedModel: "gpt-test",
            setSelectedModel: mockSetSelectedModel,
            settingsProvider: "openai",
        })
        mockUseDocumentMentionSuggestions.mockReturnValue({
            documentSuggestions: [],
            resetDocumentSuggestions: vi.fn(),
        })
    })

    afterEach(() => {
        cleanupRoots()
        vi.restoreAllMocks()
    })

    it("loads recent changes from the audit-log endpoint and links to the AI collection", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createJSONResponse({
                    changes: [
                        {
                            additions: 1,
                            removals: 0,
                            title: "Change",
                        },
                    ],
                })
            )
        )

        const { container } = render(<AIInput />)
        await flushPromises()

        expect(fetch).toHaveBeenCalledWith("/api/ai-audit-log")
        expect(container.querySelector('[data-testid="recent-changes"]')?.textContent).toBe("1")
        expect(container.querySelector('[data-testid="recent-changes"]')?.getAttribute("data-all-url")).toBe("/admin/collections/payload-ai-auditlog")
    })

    it("submits prompts, streams plain responses and clears the input when no proposals return", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createJSONResponse({ changes: [] }))
            .mockResolvedValueOnce(
                createStreamResponse(
                    'event: text\ndata: {"delta":"**No action needed**"}\n\n' +
                        'event: proposals\ndata: {"proposals":[],"usage":null}\n\n' +
                        "event: done\ndata: {}\n\n"
                )
            )
        installFetchMock(fetchMock)

        const { container } = render(<AIInput />)
        await flushPromises()

        const input = container.querySelector<HTMLElement>('[role="textbox"]')
        const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))

        act(() => {
            if (input) input.innerText = "Tell me about this"
            input?.dispatchEvent(new InputEvent("input", { bubbles: true }))
        })

        await act(async () => {
            sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await Promise.resolve()
        })
        await flushPromises()

        expect(fetchMock).toHaveBeenNthCalledWith(
            2,
            "/api/ai-chat",
            expect.objectContaining({
                body: JSON.stringify({
                    mentions: [],
                    model: "gpt-test",
                    prompt: "Tell me about this",
                }),
                method: "POST",
            })
        )
        expect(container.querySelector('[data-testid="toast-description"]')?.textContent).toBe("No action needed")
        expect(input?.textContent).toBe("")
    })

    it("shows request errors from the chat endpoint", async () => {
        const fetchMock = vi
            .fn()
            .mockResolvedValueOnce(createJSONResponse({ changes: [] }))
            .mockResolvedValueOnce(createJSONResponse({ error: "Missing key" }, false))
        installFetchMock(fetchMock)

        const { container } = render(<AIInput />)
        await flushPromises()

        const input = container.querySelector<HTMLElement>('[role="textbox"]')
        const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))

        act(() => {
            if (input) input.innerText = "Hello"
            input?.dispatchEvent(new InputEvent("input", { bubbles: true }))
        })

        await act(async () => {
            sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await Promise.resolve()
        })
        await flushPromises()

        expect(container.querySelector('[data-testid="toast-error"]')?.textContent).toBe("Missing key")
    })

    it("updates the selected model through settings", async () => {
        installFetchMock(vi.fn().mockResolvedValue(createJSONResponse({ changes: [] })))
        const { container } = render(<AIInput />)
        await flushPromises()
        const select = container.querySelector("select")

        act(() => {
            if (select) select.value = "gpt-4.1"
            select?.dispatchEvent(new Event("change", { bubbles: true }))
        })

        expect(mockSetSelectedModel).toHaveBeenCalledWith("gpt-4.1")
    })
})

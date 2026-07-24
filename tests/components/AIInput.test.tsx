// @vitest-environment jsdom

import type React from "react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AIInput from "../../src/components/ai-input/AIInput.js"
import { adminConfig } from "../fixtures/payloadConfig.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockUseDocumentForm = vi.hoisted(() => vi.fn())
const mockUseDocumentInfo = vi.hoisted(() => vi.fn())
const mockUseLocale = vi.hoisted(() => vi.fn())
const mockUseAISettings = vi.hoisted(() => vi.fn())
const mockUsePluginConfig = vi.hoisted(() => vi.fn())
const mockUseMentions = vi.hoisted(() => vi.fn())
const mockUseAIChatStream = vi.hoisted(() => vi.fn())

vi.mock("@payloadcms/ui", () => ({
    Button: ({
        children,
        disabled,
        onClick,
        type = "button",
        url,
        ...props
    }: {
        children: React.ReactNode
        disabled?: boolean
        onClick?: () => void
        type?: "button" | "submit"
        url?: string
    } & React.ButtonHTMLAttributes<HTMLButtonElement>) =>
        url ? (
            <a href={url}>{children}</a>
        ) : (
            <button disabled={disabled} onClick={onClick} type={type} {...props}>
                {children}
            </button>
        ),
    ChevronIcon: ({ direction }: { direction?: string }) => <span data-direction={direction} data-testid="chevron-icon" />,
    PaperclipIcon: () => <span data-testid="paperclip-icon" />,
    useConfig: mockUseConfig,
    useDocumentForm: mockUseDocumentForm,
    useDocumentInfo: mockUseDocumentInfo,
    useLocale: mockUseLocale,
}))

vi.mock("../../src/components/hooks/useAISettings.js", () => ({
    useAISettings: mockUseAISettings,
}))

vi.mock("../../src/components/hooks/usePluginConfig.js", () => ({
    usePluginConfig: mockUsePluginConfig,
}))

vi.mock("../../src/components/hooks/useMentions.js", () => ({
    getTextBeforeCaret: vi.fn(() => ""),
    useMentions: mockUseMentions,
}))

vi.mock("../../src/components/hooks/useAIChatStream.js", () => ({
    useAIChatStream: mockUseAIChatStream,
}))

vi.mock("../../src/components/action-toast/ActionToast.js", () => ({
    ActionToast: ({
        description,
        error,
        onApply,
        proposals,
    }: {
        description?: string
        error?: string
        onApply: (proposal: unknown, index: number) => void
        proposals: unknown[]
    }) => (
        <div data-testid="action-toast">
            <span data-testid="toast-description">{description || ""}</span>
            <span data-testid="toast-error">{error || ""}</span>
            <span data-testid="toast-proposals">{proposals.length}</span>
            {proposals[0] ? (
                <button data-testid="apply-proposal" onClick={() => onApply(proposals[0], 0)} type="button">
                    Apply
                </button>
            ) : null}
        </div>
    ),
}))

const setEditorText = (editor: HTMLElement, value: string) => {
    Object.defineProperty(editor, "innerText", {
        configurable: true,
        value,
    })

    editor.dispatchEvent(new Event("input", { bubbles: true }))
}

const flushPromises = async (ticks = 1) => {
    for (let index = 0; index < ticks; index += 1) {
        await Promise.resolve()
    }
}

const renderExpandedAIInput = () => {
    const rendered = render(<AIInput />)

    act(() => {
        rendered.container.querySelector<HTMLButtonElement>('[aria-expanded="false"]')?.click()
    })

    return rendered
}

describe("AIInput", () => {
    const mockSubmit = vi.fn()
    const mockDismissChat = vi.fn()
    const mockResetChatState = vi.fn()
    const mockSetError = vi.fn()
    const mockSetSelectedModel = vi.fn()
    const mockUpdateMentionState = vi.fn()
    const mockClearMentions = vi.fn()
    const mockInsertMention = vi.fn()
    const mockResetForm = vi.fn()
    const mockSetModified = vi.fn()
    const mockMentionsRef = { current: [] }

    beforeEach(() => {
        vi.clearAllMocks()
        mockUseConfig.mockReturnValue({ config: adminConfig })
        mockUseDocumentInfo.mockReturnValue({
            collectionSlug: "posts",
            id: "post-1",
        })
        mockUseDocumentForm.mockReturnValue({
            getData: vi.fn(() => ({ title: "Old", settings: { theme: "light" } })),
            reset: mockResetForm,
            setModified: mockSetModified,
        })
        mockUseLocale.mockReturnValue({ code: "en" })

        mockUsePluginConfig.mockReturnValue({
            aiModelConfig: {
                defaults: {
                    openai: "gpt-test",
                },
                providers: {
                    openai: [
                        {
                            label: "GPT Test",
                            value: "gpt-test",
                        },
                        {
                            label: "GPT 4.1",
                            value: "gpt-4.1",
                        },
                    ],
                },
            },
            defaultLocale: undefined,
            isCollectionMentionEnabled: vi.fn(() => true),
            locales: [],
            managedProviders: false,
            media: {
                acceptedMimeTypes: ["image/*"],
                collectionSlug: "media",
                enabled: true,
                maxFileSize: 1024,
            },
            providerProfiles: [
                {
                    defaultModel: "gpt-test",
                    id: "openai",
                    label: "OpenAI",
                    models: [
                        {
                            label: "GPT Test",
                            value: "gpt-test",
                        },
                        {
                            label: "GPT 4.1",
                            value: "gpt-4.1",
                        },
                    ],
                    provider: "openai",
                },
            ],
        })

        mockUseAISettings.mockReturnValue({
            selectedModel: "gpt-test",
            setSelectedModel: mockSetSelectedModel,
            setSelectedProviderModel: mockSetSelectedModel,
            settingsProvider: "openai",
        })

        mockUseMentions.mockReturnValue({
            clearMentions: mockClearMentions,
            insertMention: mockInsertMention,
            mentionPopoverPosition: null,
            mentionRange: null,
            mentionSuggestions: [],
            mentionsRef: mockMentionsRef,
            updateMentionState: mockUpdateMentionState,
        })

        mockUseAIChatStream.mockReturnValue({
            dismissChat: vi.fn(),
            error: "",
            isLoading: false,
            proposals: [],
            resetChatState: vi.fn(),
            response: "",
            setError: mockSetError,
            setIsLoading: vi.fn(),
            setProposals: vi.fn(),
            setResponse: vi.fn(),
            setTokenUsage: vi.fn(),
            submit: mockSubmit,
            tokenUsage: null,
        })
    })

    it("is collapsed by default in collections and globals", () => {
        const { container } = render(<AIInput />)
        const toggle = container.querySelector<HTMLButtonElement>('[aria-expanded="false"]')

        expect(toggle?.textContent).toContain("AI Assistant")
        expect(container.querySelector('[aria-label="AIInput"]')).toBeNull()
        expect(container.querySelector('[data-testid="chevron-icon"]')?.getAttribute("data-direction")).toBe("down")

        act(() => {
            toggle?.click()
        })

        expect(toggle?.getAttribute("aria-expanded")).toBe("true")
        expect(container.querySelector('[aria-label="AIInput"]')).not.toBeNull()
        expect(container.querySelector('[data-testid="chevron-icon"]')?.getAttribute("data-direction")).toBe("up")
    })

    it("passes the current collection document as chat scope", () => {
        renderExpandedAIInput()

        expect(mockUseAIChatStream).toHaveBeenCalledWith(
            expect.objectContaining({
                documentScope: {
                    collection: "posts",
                    id: "post-1",
                    type: "collection",
                },
            })
        )
    })

    it("applies document proposals to the local form without saving", async () => {
        mockUseAIChatStream.mockReturnValue({
            ...mockUseAIChatStream(),
            proposals: [
                {
                    action: "update",
                    collection: "posts",
                    data: {
                        settings: { layout: "wide" },
                        title: "New",
                    },
                    id: "post-1",
                    label: "Update current post",
                },
            ],
        })

        const { container } = renderExpandedAIInput()

        await act(async () => {
            container.querySelector<HTMLButtonElement>('[data-testid="apply-proposal"]')?.click()
            await Promise.resolve()
        })

        expect(mockResetForm).toHaveBeenCalledWith({
            settings: {
                layout: "wide",
                theme: "light",
            },
            title: "New",
        })
        expect(mockSetModified).toHaveBeenCalledWith(true)
    })

    afterEach(() => {
        cleanupRoots()
        vi.unstubAllGlobals()
        vi.restoreAllMocks()
    })

    it("updates prompt text and mention state from the editor", () => {
        const { container } = renderExpandedAIInput()

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')

        act(() => {
            if (editor) setEditorText(editor, "Tell me about this")
        })

        expect(mockUpdateMentionState).toHaveBeenCalled()
    })

    it("clears mentions when the editor is emptied", () => {
        const { container } = renderExpandedAIInput()

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')

        act(() => {
            if (editor) setEditorText(editor, "")
        })

        expect(mockClearMentions).toHaveBeenCalled()
    })

    it("submits through the chat stream hook", async () => {
        const { container } = renderExpandedAIInput()

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')
        const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))

        act(() => {
            if (editor) setEditorText(editor, "Tell me about this")
        })

        await act(async () => {
            sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await flushPromises(2)
        })

        expect(mockSubmit).toHaveBeenCalledWith({ attachments: [] })
    })

    it("uploads selected media before submitting with attachments", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                json: vi.fn().mockResolvedValue({
                    attachment: {
                        collection: "media",
                        filename: "hero.png",
                        filesize: 512,
                        id: "media-1",
                        mimeType: "image/png",
                        type: "media",
                        url: "/media/hero.png",
                    },
                }),
                ok: true,
            })
        )

        const { container } = renderExpandedAIInput()
        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')
        const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
        const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))
        const file = new File(["test"], "hero.png", { type: "image/png" })

        if (!fileInput) throw new Error("File input was not rendered")

        act(() => {
            if (editor) setEditorText(editor, "Use this image")
        })

        Object.defineProperty(fileInput, "files", {
            configurable: true,
            value: [file],
        })

        await act(async () => {
            fileInput.dispatchEvent(new Event("change", { bubbles: true }))
            await flushPromises(2)
        })

        await act(async () => {
            sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await flushPromises(6)
        })

        expect(fetch).toHaveBeenCalledWith(
            "/api/ai-upload-media",
            expect.objectContaining({
                body: expect.any(FormData),
                method: "POST",
            })
        )
        expect(mockSubmit).toHaveBeenCalledWith({
            attachments: [
                {
                    collection: "media",
                    filename: "hero.png",
                    filesize: 512,
                    id: "media-1",
                    mimeType: "image/png",
                    type: "media",
                    url: "/media/hero.png",
                },
            ],
        })
    })

    it("does not submit when media upload fails", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                json: vi.fn().mockResolvedValue({
                    error: "File type is not accepted: application/pdf",
                }),
                ok: false,
            })
        )

        const { container } = renderExpandedAIInput()
        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')
        const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
        const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))
        const file = new File(["test"], "paper.pdf", { type: "application/pdf" })

        if (!fileInput) throw new Error("File input was not rendered")

        act(() => {
            if (editor) setEditorText(editor, "Use this file")
        })

        Object.defineProperty(fileInput, "files", {
            configurable: true,
            value: [file],
        })

        await act(async () => {
            fileInput.dispatchEvent(new Event("change", { bubbles: true }))
            await flushPromises(2)
        })

        await act(async () => {
            sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await flushPromises(6)
        })

        expect(fetch).toHaveBeenCalledWith(
            "/api/ai-upload-media",
            expect.objectContaining({
                body: expect.any(FormData),
                method: "POST",
            })
        )
        expect(mockSubmit).not.toHaveBeenCalled()
        expect(mockSetError).toHaveBeenCalledWith("File type is not accepted: application/pdf")
    })

    it("reuses uploaded attachments when chat submission is retried", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn().mockResolvedValue({
                json: vi.fn().mockResolvedValue({
                    attachment: {
                        collection: "media",
                        filename: "hero.png",
                        filesize: 512,
                        id: "media-1",
                        mimeType: "image/png",
                        type: "media",
                        url: "/media/hero.png",
                    },
                }),
                ok: true,
            })
        )
        mockSubmit.mockRejectedValueOnce(new Error("AI request failed")).mockResolvedValueOnce(undefined)

        const { container } = renderExpandedAIInput()
        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')
        const fileInput = container.querySelector<HTMLInputElement>('input[type="file"]')
        const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))
        const file = new File(["test"], "hero.png", { type: "image/png" })

        if (!fileInput) throw new Error("File input was not rendered")

        act(() => {
            if (editor) setEditorText(editor, "Use this image")
        })

        Object.defineProperty(fileInput, "files", {
            configurable: true,
            value: [file],
        })

        await act(async () => {
            fileInput.dispatchEvent(new Event("change", { bubbles: true }))
            await flushPromises(2)
        })

        await act(async () => {
            sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await flushPromises(6)
        })

        await act(async () => {
            await new Promise((resolve) => window.setTimeout(resolve, 0))
        })

        const retrySendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))

        await act(async () => {
            retrySendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await flushPromises(6)
        })

        const uploadCalls = (fetch as ReturnType<typeof vi.fn>).mock.calls.filter((call) => call[0] === "/api/ai-upload-media")

        expect(uploadCalls).toHaveLength(1)
        expect(mockSubmit).toHaveBeenCalledTimes(2)
        expect(mockSubmit).toHaveBeenLastCalledWith({
            attachments: [
                {
                    collection: "media",
                    filename: "hero.png",
                    filesize: 512,
                    id: "media-1",
                    mimeType: "image/png",
                    type: "media",
                    url: "/media/hero.png",
                },
            ],
        })
    })

    it("submits on enter without shift", async () => {
        const { container } = renderExpandedAIInput()

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')

        act(() => {
            if (editor) setEditorText(editor, "Tell me about this")
        })

        await act(async () => {
            editor?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    key: "Enter",
                })
            )
            await flushPromises(2)
        })

        expect(mockSubmit).toHaveBeenCalledWith({ attachments: [] })
    })

    it("updates the selected model through settings", () => {
        const { container } = renderExpandedAIInput()
        const select = container.querySelector("select")

        act(() => {
            if (select) select.value = JSON.stringify(["openai", "gpt-4.1"])
            select?.dispatchEvent(new Event("change", { bubbles: true }))
        })

        expect(mockSetSelectedModel).toHaveBeenCalledWith("openai", "gpt-4.1")
    })

    it("groups models from managed providers in the model select", () => {
        mockUsePluginConfig.mockReturnValue({
            aiModelConfig: {
                defaults: { openai: "gpt-test" },
                providers: { openai: [{ label: "GPT Test", value: "gpt-test" }] },
            },
            defaultLocale: undefined,
            isCollectionMentionEnabled: vi.fn(() => true),
            locales: [],
            managedProviders: true,
            media: undefined,
            providerProfiles: [
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
                    models: [{ label: "Llama 3.3", value: "llama3.3" }],
                    provider: "openai",
                },
            ],
        })
        mockUseAISettings.mockReturnValue({
            selectedModel: "gpt-test",
            setSelectedModel: mockSetSelectedModel,
            setSelectedProviderModel: mockSetSelectedModel,
            settingsProvider: "company-openai",
        })

        const { container } = renderExpandedAIInput()
        const groups = Array.from(container.querySelectorAll("optgroup"))

        expect(groups.map((group) => group.label)).toEqual(["Company OpenAI", "Ollama"])
        expect(groups.map((group) => group.querySelector("option")?.textContent)).toEqual(["GPT Test", "Llama 3.3"])
    })

    it("renders chat stream state in the action toast", () => {
        mockUseAIChatStream.mockReturnValue({
            dismissChat: mockDismissChat,
            error: "Missing key",
            isLoading: false,
            proposals: [{ label: "Proposal" }],
            resetChatState: mockResetChatState,
            response: "AI response",
            setError: mockSetError,
            setProposals: vi.fn(),
            setResponse: vi.fn(),
            setTokenUsage: vi.fn(),
            submit: mockSubmit,
            tokenUsage: null,
        })

        const { container } = renderExpandedAIInput()

        expect(container.querySelector('[data-testid="toast-description"]')?.textContent).toBe("AI response")
        expect(container.querySelector('[data-testid="toast-error"]')?.textContent).toBe("Missing key")
        expect(container.querySelector('[data-testid="toast-proposals"]')?.textContent).toBe("1")
    })
})

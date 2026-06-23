// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AIInput from "../../src/components/ai-input/AIInput.js"
import { adminConfig } from "../fixtures/payloadConfig.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const mockUseConfig = vi.hoisted(() => vi.fn())
const mockUseAISettings = vi.hoisted(() => vi.fn())
const mockUsePluginConfig = vi.hoisted(() => vi.fn())
const mockUseMentions = vi.hoisted(() => vi.fn())
const mockUseAIChatStream = vi.hoisted(() => vi.fn())

vi.mock("@payloadcms/ui", () => ({
    useConfig: mockUseConfig,
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
    ActionToast: ({ description, error, proposals }: { description?: string; error?: string; proposals: unknown[] }) => (
        <div data-testid="action-toast">
            <span data-testid="toast-description">{description || ""}</span>
            <span data-testid="toast-error">{error || ""}</span>
            <span data-testid="toast-proposals">{proposals.length}</span>
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

describe("AIInput", () => {
    const mockSubmit = vi.fn()
    const mockDismissChat = vi.fn()
    const mockResetChatState = vi.fn()
    const mockSetError = vi.fn()
    const mockSetSelectedModel = vi.fn()
    const mockUpdateMentionState = vi.fn()
    const mockClearMentions = vi.fn()
    const mockInsertMention = vi.fn()
    const mockMentionsRef = { current: [] }

    beforeEach(() => {
        mockUseConfig.mockReturnValue({ config: adminConfig })

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
        })

        mockUseAISettings.mockReturnValue({
            selectedModel: "gpt-test",
            setSelectedModel: mockSetSelectedModel,
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
            setError: vi.fn(),
            setProposals: vi.fn(),
            setResponse: vi.fn(),
            setTokenUsage: vi.fn(),
            submit: mockSubmit,
            tokenUsage: null,
        })
    })

    afterEach(() => {
        cleanupRoots()
        vi.restoreAllMocks()
    })

    it("updates prompt text and mention state from the editor", () => {
        const { container } = render(<AIInput />)

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')

        act(() => {
            if (editor) setEditorText(editor, "Tell me about this")
        })

        expect(mockUpdateMentionState).toHaveBeenCalled()
    })

    it("clears mentions when the editor is emptied", () => {
        const { container } = render(<AIInput />)

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')

        act(() => {
            if (editor) setEditorText(editor, "")
        })

        expect(mockClearMentions).toHaveBeenCalled()
    })

    it("submits through the chat stream hook", () => {
        const { container } = render(<AIInput />)

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')
        const sendButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Send"))

        act(() => {
            if (editor) setEditorText(editor, "Tell me about this")
        })

        act(() => {
            sendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(mockSubmit).toHaveBeenCalled()
    })

    it("submits on enter without shift", () => {
        const { container } = render(<AIInput />)

        const editor = container.querySelector<HTMLElement>('[aria-label="AIInput"]')

        act(() => {
            if (editor) setEditorText(editor, "Tell me about this")
        })

        act(() => {
            editor?.dispatchEvent(
                new KeyboardEvent("keydown", {
                    bubbles: true,
                    key: "Enter",
                })
            )
        })

        expect(mockSubmit).toHaveBeenCalled()
    })

    it("updates the selected model through settings", () => {
        const { container } = render(<AIInput />)
        const select = container.querySelector("select")

        act(() => {
            if (select) select.value = "gpt-4.1"
            select?.dispatchEvent(new Event("change", { bubbles: true }))
        })

        expect(mockSetSelectedModel).toHaveBeenCalledWith("gpt-4.1")
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

        const { container } = render(<AIInput />)

        expect(container.querySelector('[data-testid="toast-description"]')?.textContent).toBe("AI response")
        expect(container.querySelector('[data-testid="toast-error"]')?.textContent).toBe("Missing key")
        expect(container.querySelector('[data-testid="toast-proposals"]')?.textContent).toBe("1")
    })
})

// @vitest-environment jsdom

import React, { useRef } from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { useAIChatStream } from "../../src/components/hooks/useAIChatStream.js"
import type { Mention } from "../../src/components/hooks/useMentions.js"
import { mockSignedUpdatePostProposal } from "../fixtures/proposals.js"
import { createJSONResponse, createStreamResponse, installFetchMock } from "../fixtures/fetch.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const flushPromises = async (ticks = 1) => {
    for (let index = 0; index < ticks; index += 1) {
        await act(async () => {
            await Promise.resolve()
        })
    }
}

const sse = (events: Array<{ data: unknown; event: string }>) =>
    events.map((event) => `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`).join("")

const clearInput = vi.fn()

const HookTest = ({ prompt = " update post " }: { prompt?: string }) => {
    const mentionsRef = useRef<Mention[]>([
        {
            collection: "posts",
            id: "post-1",
            label: "Jupiter",
            slug: "jupiter",
            type: "doc",
        },
    ])
    const { dismissChat, error, isLoading, proposals, response, submit, tokenUsage } = useAIChatStream({
        apiRoute: "/api",
        clearInput,
        mentionsRef,
        prompt,
        selectedModel: "gpt-test",
        selectedProvider: "openai",
    })

    return (
        <div>
            <span data-testid="response">{response}</span>
            <span data-testid="error">{error}</span>
            <span data-testid="loading">{String(isLoading)}</span>
            <span data-testid="proposals">{proposals.map((proposal) => proposal.label).join(",")}</span>
            <span data-testid="tokens">{tokenUsage?.totalTokens ?? ""}</span>
            <button onClick={() => void submit()} type="button">
                Submit
            </button>
            <button
                onClick={() =>
                    void submit({
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
                }
                type="button"
            >
                Submit with attachments
            </button>
            <button onClick={dismissChat} type="button">
                Dismiss
            </button>
        </div>
    )
}

describe("useAIChatStream", () => {
    afterEach(() => {
        cleanupRoots()
        clearInput.mockClear()
        vi.restoreAllMocks()
    })

    it("does not submit blank prompts", async () => {
        installFetchMock()

        const { container } = render(<HookTest prompt="   " />)

        act(() => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        await flushPromises()

        expect(fetch).not.toHaveBeenCalled()
    })

    it("posts the prompt, streams text, deduplicates proposals, and stores token usage", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createStreamResponse(
                    sse([
                        { data: { delta: "**Draft** " }, event: "text" },
                        {
                            data: {
                                proposals: [mockSignedUpdatePostProposal, mockSignedUpdatePostProposal],
                                usage: { totalTokens: 42 },
                            },
                            event: "proposals",
                        },
                        { data: {}, event: "done" },
                    ])
                )
            )
        )

        const { container } = render(<HookTest />)

        act(() => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        await flushPromises(8)

        expect(fetch).toHaveBeenCalledWith(
            "/api/ai-chat",
            expect.objectContaining({
                body: JSON.stringify({
                    mentions: [
                        {
                            collection: "posts",
                            id: "post-1",
                            label: "Jupiter",
                            slug: "jupiter",
                            type: "doc",
                        },
                    ],
                    model: "gpt-test",
                    prompt: "update post",
                    provider: "openai",
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            })
        )
        expect(container.querySelector('[data-testid="response"]')?.textContent).toBe("Draft ")
        expect(container.querySelector('[data-testid="proposals"]')?.textContent).toBe("Update Jupiter")
        expect(container.querySelector('[data-testid="tokens"]')?.textContent).toBe("42")
        expect(container.querySelector('[data-testid="loading"]')?.textContent).toBe("false")
        expect(clearInput).not.toHaveBeenCalled()
    })

    it("shows debug feedback and clears the input when no proposals are returned", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createStreamResponse(
                    sse([
                        { data: { proposalCount: 0, reason: "model_did_not_call_tool" }, event: "debug" },
                        { data: {}, event: "done" },
                    ])
                )
            )
        )

        const { container } = render(<HookTest />)

        act(() => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        await flushPromises(8)

        expect(container.querySelector('[data-testid="response"]')?.textContent).toBe("Model did not create a proposal tool call.")
        expect(container.querySelector('[data-testid="proposals"]')?.textContent).toBe("")
        expect(clearInput).toHaveBeenCalledTimes(1)
    })

    it("includes media attachments in the chat body", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createStreamResponse(
                    sse([
                        { data: { proposals: [], usage: { totalTokens: 1 } }, event: "proposals" },
                        { data: {}, event: "done" },
                    ])
                )
            )
        )

        const { container } = render(<HookTest />)

        act(() => {
            container.querySelectorAll("button")[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        await flushPromises(8)

        expect(fetch).toHaveBeenCalledWith(
            "/api/ai-chat",
            expect.objectContaining({
                body: JSON.stringify({
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
                    mentions: [
                        {
                            collection: "posts",
                            id: "post-1",
                            label: "Jupiter",
                            slug: "jupiter",
                            type: "doc",
                        },
                    ],
                    model: "gpt-test",
                    prompt: "update post",
                    provider: "openai",
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            })
        )
    })

    it("stores errors from failed responses", async () => {
        installFetchMock(vi.fn().mockResolvedValue(createJSONResponse({ error: "No provider configured" }, false)))

        const { container } = render(<HookTest />)

        act(() => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        await flushPromises(4)

        expect(container.querySelector('[data-testid="error"]')?.textContent).toBe("No provider configured")
        expect(container.querySelector('[data-testid="response"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="proposals"]')?.textContent).toBe("")
    })

    it("dismisses chat state and clears the input", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createStreamResponse(
                    sse([
                        { data: { delta: "Done" }, event: "text" },
                        { data: { proposals: [mockSignedUpdatePostProposal] }, event: "proposals" },
                        { data: {}, event: "done" },
                    ])
                )
            )
        )

        const { container } = render(<HookTest />)

        act(() => {
            container.querySelectorAll("button")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        await flushPromises(8)

        expect(container.querySelector('[data-testid="response"]')?.textContent).toBe("Done")

        act(() => {
            container.querySelectorAll("button")[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="response"]')?.textContent).toBe("")
        expect(clearInput).toHaveBeenCalled()
    })
})

// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDocumentMentionSuggestions } from "../../src/components/hooks/useDocumentMentionSuggestions.js"
import { mentionOptionJupiter } from "../fixtures/docs.js"
import { createJSONResponse, installFetchMock } from "../fixtures/fetch.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const flushPromises = async () => {
    await act(async () => {
        await Promise.resolve()
    })
}

const HookTest = ({
    collection,
    query,
    range = { end: 2, start: 0 },
}: {
    collection?: null | string
    query: string
    range?: null | { end: number; start: number }
}) => {
    const { documentSuggestions, resetDocumentSuggestions } = useDocumentMentionSuggestions({
        apiRoute: "/api",
        documentSuggestionCollection: collection,
        mentionQuery: query,
        mentionRange: range,
    })

    return (
        <div>
            <span data-testid="count">{documentSuggestions.length}</span>
            <span data-testid="labels">{documentSuggestions.map((suggestion) => suggestion.label).join(",")}</span>
            <button onClick={resetDocumentSuggestions} type="button">
                Reset
            </button>
        </div>
    )
}

describe("useDocumentMentionSuggestions", () => {
    afterEach(() => {
        cleanupRoots()
        vi.restoreAllMocks()
    })

    it("does not fetch without an active mention range", async () => {
        installFetchMock()

        render(<HookTest query="j" range={null} />)
        await flushPromises()

        expect(fetch).not.toHaveBeenCalled()
    })

    it("fetches document suggestions for the typed query", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createJSONResponse({
                    suggestions: [mentionOptionJupiter],
                })
            )
        )

        const { container } = render(<HookTest query=" j " />)
        await flushPromises()

        expect(fetch).toHaveBeenCalledWith(
            "/api/ai-mention-suggestion",
            expect.objectContaining({
                body: JSON.stringify({
                    collectionSlug: undefined,
                    query: "j",
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            })
        )
        expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("1")
        expect(container.querySelector('[data-testid="labels"]')?.textContent).toBe("Jupiter")
    })

    it("fetches all documents from the selected collection instead of using the query", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createJSONResponse({
                    suggestions: [],
                })
            )
        )

        render(<HookTest collection="posts" query="posts" />)
        await flushPromises()

        expect(fetch).toHaveBeenCalledWith(
            "/api/ai-mention-suggestion",
            expect.objectContaining({
                body: JSON.stringify({
                    collectionSlug: "posts",
                    query: "",
                }),
            })
        )
    })

    it("can reset loaded suggestions", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createJSONResponse({
                    suggestions: [mentionOptionJupiter],
                })
            )
        )

        const { container } = render(<HookTest query="j" />)
        await flushPromises()

        expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("1")

        act(() => {
            container.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("0")
    })
})

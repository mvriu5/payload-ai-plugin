// @vitest-environment jsdom

import React, { useRef, useState } from "react"
import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { useMentions } from "../../src/components/hooks/useMentions.js"
import type { MentionOption } from "../../src/components/mention-popover/MentionPopover.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const resetDocumentSuggestions = vi.fn()

vi.mock("../../src/components/hooks/useDocumentMentionSuggestions.js", () => ({
    useDocumentMentionSuggestions: vi.fn(() => ({
        documentSuggestions: [
            {
                collection: "posts",
                id: "post-1",
                label: "Jupiter",
                slug: "jupiter",
                type: "doc",
            },
        ],
        resetDocumentSuggestions,
    })),
}))

const styles = {
    badge: "badge",
    badgeIcon: "badgeIcon",
    collection: "collection",
    doc: "doc",
    global: "global",
    inlineBadge: "inlineBadge",
    locale: "locale",
    name: "name",
    prefix: "prefix",
}

const config = {
    collections: [
        {
            fields: [],
            labels: {
                singular: "Post",
            },
            slug: "posts",
        },
        {
            fields: [],
            labels: {
                singular: "Page",
            },
            slug: "pages",
        },
        {
            fields: [],
            labels: {
                singular: "Internal",
            },
            slug: "payload-internal",
        },
    ],
    globals: [
        {
            fields: [],
            label: "Site Settings",
            slug: "site-settings",
        },
    ],
}

const HookTest = ({ enabledSlugs = ["posts", "pages"] }: { enabledSlugs?: string[] }) => {
    const editorRef = useRef<HTMLDivElement | null>(null)
    const [prompt, setPrompt] = useState("@po")
    const [, rerender] = useState(0)
    const { clearMentions, insertMention, mentionQuery, mentionRange, mentionSuggestions, mentionsRef, updateMentionState } = useMentions({
        apiRoute: "/api",
        config,
        defaultLocale: "en",
        editorRef,
        isCollectionMentionEnabled: (slug) => enabledSlugs.includes(slug),
        locales: [
            { code: "en", label: "English" },
            { code: "de", label: "Deutsch" },
        ],
        setPrompt,
        styles,
    })

    const insertFirst = () => {
        const suggestion = mentionSuggestions[0] as MentionOption | undefined
        if (suggestion) insertMention(suggestion)
    }

    return (
        <div>
            <div contentEditable ref={editorRef} suppressContentEditableWarning>
                @po
            </div>
            <span data-testid="query">{mentionQuery}</span>
            <span data-testid="range">{mentionRange ? `${mentionRange.start}-${mentionRange.end}` : ""}</span>
            <span data-testid="suggestions">{mentionSuggestions.map((suggestion) => `${suggestion.type}:${suggestion.slug}`).join(",")}</span>
            <span data-testid="mentions">{mentionsRef.current.map((mention) => `${mention.type}:${mention.slug}`).join(",")}</span>
            <span data-testid="prompt">{prompt}</span>
            <button onClick={() => updateMentionState("@po")} type="button">
                Update
            </button>
            <button onClick={() => updateMentionState("email@po")} type="button">
                Invalid
            </button>
            <button onClick={insertFirst} type="button">
                Insert
            </button>
            <button
                onClick={() => {
                    clearMentions()
                    rerender((current) => current + 1)
                }}
                type="button"
            >
                Clear
            </button>
        </div>
    )
}

describe("useMentions", () => {
    beforeEach(() => {
        Range.prototype.getBoundingClientRect = vi.fn(() => ({
            bottom: 24,
            height: 16,
            left: 12,
            right: 32,
            top: 8,
            width: 20,
            x: 12,
            y: 8,
            toJSON: () => ({}),
        }))
    })

    afterEach(() => {
        cleanupRoots()
        resetDocumentSuggestions.mockClear()
        vi.restoreAllMocks()
    })

    it("builds filtered mention suggestions for an active query", () => {
        const { container } = render(<HookTest />)

        act(() => {
            container.querySelectorAll("button")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="query"]')?.textContent).toBe("po")
        expect(container.querySelector('[data-testid="range"]')?.textContent).toBe("0-3")
        expect(container.querySelector('[data-testid="suggestions"]')?.textContent).toBe("collection:posts,doc:jupiter")
    })

    it("resets mention state when the at-sign is not at a mention boundary", () => {
        const { container } = render(<HookTest />)

        act(() => {
            container.querySelectorAll("button")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        act(() => {
            container.querySelectorAll("button")[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="query"]')?.textContent).toBe("")
        expect(container.querySelector('[data-testid="range"]')?.textContent).toBe("")
    })

    it("inserts a selected mention and can clear stored mentions", () => {
        const { container } = render(<HookTest />)

        act(() => {
            container.querySelectorAll("button")[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })
        act(() => {
            container.querySelectorAll("button")[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="prompt"]')?.textContent).toBe("collection: Post ")
        expect(container.querySelector('[data-testid="mentions"]')?.textContent).toBe("collection:posts")
        expect(resetDocumentSuggestions).toHaveBeenCalledTimes(1)

        act(() => {
            container.querySelectorAll("button")[3]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="mentions"]')?.textContent).toBe("")
        expect(resetDocumentSuggestions).toHaveBeenCalledTimes(2)
    })
})

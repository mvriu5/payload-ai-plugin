// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { DiffDialog } from "../../src/components/DiffDialog.js"
import { cleanupRoots, render } from "../fixtures/react.js"

vi.mock("@payloadcms/ui/icons/X", () => ({
    XIcon: () => <span aria-hidden="true">x</span>,
}))

const proposal = {
    action: "update" as const,
    collection: "posts",
    id: "4",
    label: "Update post",
}

describe("DiffDialog", () => {
    afterEach(() => {
        cleanupRoots()
    })

    it("renders metadata, token usage and paired changed JSON lines", () => {
        const { container } = render(
            <DiffDialog
                diff={{
                    after: {
                        id: 4,
                        title: "New",
                    },
                    before: {
                        id: 4,
                        title: "Old",
                    },
                }}
                onClose={vi.fn()}
                proposal={proposal}
                tokenUsage={{
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                }}
            />
        )

        expect(container.querySelector('[role="dialog"]')).toBeTruthy()
        expect(container.textContent).toContain("Update post")
        expect(container.textContent).toContain("update in posts #4")
        expect(container.textContent).toContain("Tokens")
        expect(container.textContent).toContain("15 (10 in / 5 out)")
        expect(container.textContent).toContain("Current")
        expect(container.textContent).toContain("Proposed")
        expect(container.textContent).toContain('"title": "Old"')
        expect(container.textContent).toContain('"title": "New"')
        expect(container.textContent).toContain("title")
    })

    it("renders locale sections", () => {
        const { container } = render(
            <DiffDialog
                diff={{
                    after: {
                        de: {
                            title: "Neu",
                        },
                        en: {
                            title: "New",
                        },
                    },
                    before: {
                        de: {
                            title: "Alt",
                        },
                        en: {
                            title: "Old",
                        },
                    },
                }}
                onClose={vi.fn()}
                proposal={proposal}
            />
        )

        expect(container.textContent).toContain("Locale: de")
        expect(container.textContent).toContain("Locale: en")
    })

    it("closes by button and Escape key", () => {
        const onClose = vi.fn()
        const { container } = render(
            <DiffDialog
                diff={{
                    after: {
                        title: "New",
                    },
                    before: {
                        title: "Old",
                    },
                }}
                onClose={onClose}
                proposal={proposal}
            />
        )

        act(() => {
            container.querySelector('button[aria-label="Close"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))
        })

        expect(onClose).toHaveBeenCalledTimes(2)
    })
})

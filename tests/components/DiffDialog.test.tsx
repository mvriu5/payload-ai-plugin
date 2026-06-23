// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DiffDialog } from "../../src/components/diff-dialog/DiffDialog.js"
import { oldPostJupiter, postJupiter } from "../fixtures/docs.js"
import { mockSignedUpdatePostProposal } from "../fixtures/proposals.js"
import { cleanupRoots, render } from "../fixtures/react.js"

vi.mock("@payloadcms/ui/icons/X", () => ({
    XIcon: () => <span aria-hidden="true">x</span>,
}))

describe("DiffDialog", () => {
    afterEach(() => {
        cleanupRoots()
    })

    it("renders metadata, token usage and paired changed JSON lines", () => {
        const { container } = render(
            <DiffDialog
                diff={{
                    after: postJupiter,
                    before: oldPostJupiter,
                }}
                onClose={vi.fn()}
                proposal={mockSignedUpdatePostProposal}
                tokenUsage={{
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                }}
            />
        )

        expect(container.querySelector("dialog")).toBeTruthy()
        expect(container.textContent).toContain("Update Jupiter")
        expect(container.textContent).toContain("update in posts #4")
        expect(container.textContent).toContain("Tokens")
        expect(container.textContent).toContain("15 (10 in / 5 out)")
        expect(container.textContent).toContain("Current")
        expect(container.textContent).toContain("Proposed")
        expect(container.textContent).toContain('"title": "Old Jupiter"')
        expect(container.textContent).toContain('"title": "Jupiter"')
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
                proposal={mockSignedUpdatePostProposal}
            />
        )

        expect(container.textContent).toContain("Locale: de")
        expect(container.textContent).toContain("Locale: en")
    })

    it("closes by button and cancel event", () => {
        const onClose = vi.fn()
        const { container } = render(
            <DiffDialog
                diff={{
                    after: postJupiter,
                    before: oldPostJupiter,
                }}
                onClose={onClose}
                proposal={mockSignedUpdatePostProposal}
            />
        )

        act(() => {
            container.querySelector('button[aria-label="Close"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            container.querySelector("dialog")?.dispatchEvent(new Event("cancel", { bubbles: true, cancelable: true }))
        })

        expect(onClose).toHaveBeenCalledTimes(2)
    })
})

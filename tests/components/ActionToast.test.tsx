// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ActionToast, type ActionProposal } from "../../src/components/action-toast/ActionToast.js"
import { oldPostJupiter, postJupiter } from "../fixtures/docs.js"
import { createJSONResponse, installFetchMock } from "../fixtures/fetch.js"
import { mockSignedUpdatePostProposal } from "../fixtures/proposals.js"
import { cleanupRoots, render } from "../fixtures/react.js"

vi.mock("../../src/components/diff-dialog/DiffDialog.js", () => ({
    DiffDialog: ({ proposal }: { proposal: ActionProposal }) => (
        <dialog aria-label={`Diff for ${proposal.label}`} open>
            Diff for {proposal.label}
        </dialog>
    ),
}))

const proposal: ActionProposal = mockSignedUpdatePostProposal

describe("ActionToast", () => {
    afterEach(() => {
        cleanupRoots()
        vi.restoreAllMocks()
    })

    it("renders nothing without error, description or proposals", () => {
        const { container } = render(<ActionToast apiRoute="/api" isApplying={false} onApply={vi.fn()} proposals={[]} />)

        expect(container.textContent).toBe("")
    })

    it("renders errors and calls onDismissError", () => {
        const onDismissError = vi.fn()
        const { container } = render(
            <ActionToast apiRoute="/api" error="Provider failed" isApplying={false} onApply={vi.fn()} onDismissError={onDismissError} proposals={[]} />
        )
        const dismissButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Dismiss")

        expect(container.textContent).toContain("AI request failed")
        expect(container.textContent).toContain("Provider failed")

        act(() => {
            dismissButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(onDismissError).toHaveBeenCalledOnce()
    })

    it("renders proposal actions, redacts signature details and calls callbacks", () => {
        const onApply = vi.fn()
        const onDismiss = vi.fn()
        const { container } = render(
            <ActionToast
                apiRoute="/api"
                description="Prepared update"
                getViewURL={() => "/admin/collections/posts/4"}
                isApplying={false}
                onApply={onApply}
                onDismiss={onDismiss}
                proposals={[proposal]}
            />
        )

        expect(container.textContent).toContain("Update Jupiter")
        expect(container.textContent).toContain("update in posts #4")
        expect(container.textContent).toContain("Prepared update")
        expect(container.textContent).toContain("[redacted]")
        expect(container.querySelector<HTMLAnchorElement>('a[href="/admin/collections/posts/4"]')?.textContent).toBe("Go to source")

        const buttons = container.querySelectorAll("button")

        act(() => {
            buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            buttons[2]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(onDismiss).toHaveBeenCalledOnce()
        expect(onApply).toHaveBeenCalledWith(proposal, 0)
    })

    it("loads and opens proposal diffs", async () => {
        installFetchMock(
            vi.fn().mockResolvedValue(
                createJSONResponse({
                    after: postJupiter,
                    before: oldPostJupiter,
                })
            )
        )
        const { container } = render(<ActionToast apiRoute="/api" isApplying={false} onApply={vi.fn()} proposals={[proposal]} />)
        const reviewButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Review")

        await act(async () => {
            reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
            await Promise.resolve()
        })

        expect(fetch).toHaveBeenCalledWith(
            "/api/ai-proposal-diff",
            expect.objectContaining({
                body: JSON.stringify({ proposal }),
                method: "POST",
            })
        )
        expect(container.querySelector("dialog")?.textContent).toBe("Diff for Update Jupiter")
    })
})

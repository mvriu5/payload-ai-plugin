// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RecentChangesList } from "../../src/components/AuditLogList.js"
import { appliedChangeJupiter, createAppliedChangeJupiter } from "../fixtures/docs.js"
import { cleanupRoots, render } from "../fixtures/react.js"

vi.mock("@payloadcms/ui", () => ({
    ExternalLinkIcon: () => <span data-testid="external-link-icon" />,
}))

vi.mock("../../src/components/DiffDialog.js", () => ({
    DiffDialog: ({ proposal }: { proposal: { label: string } }) => <div role="dialog">Diff for {proposal.label}</div>,
}))

describe("RecentChangesList", () => {
    afterEach(() => {
        cleanupRoots()
    })

    it("shows an empty state", () => {
        const { container } = render(<RecentChangesList changes={[]} />)

        expect(container.textContent).toContain("No changes yet.")
    })

    it("shows the view-all link in the header", () => {
        const { container } = render(<RecentChangesList allChangesURL="/admin/collections/payload-ai-auditlog" changes={[]} />)
        const link = container.querySelector<HTMLAnchorElement>('a[href="/admin/collections/payload-ai-auditlog"]')

        expect(link?.textContent).toBe("View all")
    })

    it("renders at most 10 changes", () => {
        const { container } = render(<RecentChangesList changes={Array.from({ length: 12 }, (_, index) => createAppliedChangeJupiter(index + 1))} />)

        expect(container.querySelectorAll("button")).toHaveLength(10)
        expect(container.textContent).toContain("Jupiter change 10")
        expect(container.textContent).not.toContain("Jupiter change 11")
    })

    it("opens the diff dialog for reviewable changes", () => {
        const { container } = render(<RecentChangesList changes={[appliedChangeJupiter]} />)
        const reviewButton = container.querySelector("button")

        act(() => {
            reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[role="dialog"]')?.textContent).toBe("Diff for Updated Jupiter")
    })
})

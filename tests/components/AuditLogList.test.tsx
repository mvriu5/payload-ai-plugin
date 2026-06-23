// @vitest-environment jsdom

import { act } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import AuditLogList from "../../src/components/audit-log-list/AuditLogList.js"
import { appliedChangeJupiter, createAppliedChangeJupiter } from "../fixtures/docs.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const mockUseAuditLog = vi.hoisted(() => vi.fn())
const mockLoadRecentChanges = vi.hoisted(() => vi.fn())

vi.mock("@payloadcms/ui", () => ({
    ExternalLinkIcon: () => <span data-testid="external-link-icon" />,
    useConfig: () => ({
        config: {
            routes: {
                admin: "/admin",
                api: "/api",
            },
        },
    }),
}))

vi.mock("../../src/components/hooks/useAuditLog.js", () => ({
    useAuditLog: mockUseAuditLog,
}))

vi.mock("../../src/components/diff-dialog/DiffDialog.js", () => ({
    DiffDialog: ({ proposal }: { proposal: { label: string } }) => (
        <dialog aria-label={`Diff for ${proposal.label}`} open>
            Diff for {proposal.label}
        </dialog>
    ),
}))

describe("AuditLogList", () => {
    beforeEach(() => {
        mockLoadRecentChanges.mockResolvedValue(undefined)

        mockUseAuditLog.mockReturnValue({
            allChangesURL: "/admin/collections/payload-ai-auditlog",
            appliedChanges: [],
            loadRecentChanges: mockLoadRecentChanges,
        })
    })

    afterEach(() => {
        cleanupRoots()
        vi.restoreAllMocks()
    })

    it("shows an empty state", async () => {
        const { container } = render(<AuditLogList />)

        expect(container.textContent).toContain("No changes yet.")
    })

    it("shows the view-all link in the header", async () => {
        const { container } = render(<AuditLogList />)

        const link = container.querySelector<HTMLAnchorElement>('a[href="/admin/collections/payload-ai-auditlog"]')

        expect(link?.textContent).toBe("View all")
    })

    it("renders at most 10 changes", async () => {
        mockUseAuditLog.mockReturnValueOnce({
            allChangesURL: "/admin/collections/payload-ai-auditlog",
            appliedChanges: Array.from({ length: 12 }, (_, index) => createAppliedChangeJupiter(index + 1)),
            loadRecentChanges: mockLoadRecentChanges,
        })

        const { container } = render(<AuditLogList />)

        expect(container.querySelectorAll("button")).toHaveLength(10)
        expect(container.textContent).toContain("Jupiter change 10")
        expect(container.textContent).not.toContain("Jupiter change 11")
    })

    it("opens the diff dialog for reviewable changes", async () => {
        mockUseAuditLog.mockReturnValueOnce({
            allChangesURL: "/admin/collections/payload-ai-auditlog",
            appliedChanges: [appliedChangeJupiter],
            loadRecentChanges: mockLoadRecentChanges,
        })

        const { container } = render(<AuditLogList />)

        const reviewButton = container.querySelector("button")

        act(() => {
            reviewButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector("dialog")?.textContent).toBe("Diff for Updated Jupiter")
    })

    it("refreshes when the audit log update event is dispatched", () => {
        render(<AuditLogList />)

        act(() => {
            window.dispatchEvent(new CustomEvent("payload-ai:audit-log-updated"))
        })

        expect(mockLoadRecentChanges).toHaveBeenCalled()
    })
})

// @vitest-environment jsdom

import React from "react"
import { act } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AppliedChange } from "../../src/components/audit-log-list/AuditLogList.js"
import { useAuditLog } from "../../src/components/hooks/useAuditLog.js"
import { createJSONResponse, installFetchMock } from "../fixtures/fetch.js"
import { cleanupRoots, render } from "../fixtures/react.js"

const changes = Array.from({ length: 10 }, (_, index) => ({
    action: "update",
    additions: index,
    removals: index,
    collection: "posts",
    documentID: String(index),
    title: `Change ${index}`,
})) as AppliedChange[]

const flushPromises = async () => {
    await act(async () => {
        await Promise.resolve()
    })
}

const HookTest = ({ adminRoute = "/admin" }: { adminRoute?: string }) => {
    const { allChangesURL, appliedChanges, loadRecentChanges, prependChange } = useAuditLog({
        adminRoute,
        apiRoute: "/api",
    })

    return (
        <div>
            <span data-testid="all-url">{allChangesURL}</span>
            <span data-testid="count">{appliedChanges.length}</span>
            <span data-testid="labels">{appliedChanges.map((change) => change.title).join(",")}</span>
            <button onClick={() => void loadRecentChanges()} type="button">
                Load
            </button>
            <button onClick={() => prependChange({ ...changes[0], title: "Newest" })} type="button">
                Prepend
            </button>
        </div>
    )
}

describe("useAuditLog", () => {
    afterEach(() => {
        cleanupRoots()
        vi.restoreAllMocks()
    })

    it("loads and limits recent changes from the audit endpoint", async () => {
        installFetchMock(vi.fn().mockResolvedValue(createJSONResponse({ changes })))

        const { container } = render(<HookTest adminRoute="/custom-admin" />)
        await flushPromises()

        expect(fetch).toHaveBeenCalledWith("/api/ai-audit-log")
        expect(container.querySelector('[data-testid="all-url"]')?.textContent).toBe("/custom-admin/collections/$payload-ai-auditlog")
        expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("8")
        expect(container.querySelector('[data-testid="labels"]')?.textContent).toBe(
            changes
                .slice(0, 8)
                .map((change) => change.title)
                .join(",")
        )
    })

    it("prepends a new change and keeps the list capped", async () => {
        installFetchMock(vi.fn().mockResolvedValue(createJSONResponse({ changes })))

        const { container } = render(<HookTest />)
        await flushPromises()

        act(() => {
            container.querySelectorAll("button")[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
        })

        expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("8")
        expect(container.querySelector('[data-testid="labels"]')?.textContent?.startsWith("Newest,Change 0")).toBe(true)
    })

    it("ignores malformed responses when loading recent changes", async () => {
        installFetchMock(
            vi
                .fn()
                .mockResolvedValue(createJSONResponse({ changes: changes.slice(0, 1) }))
                .mockResolvedValueOnce(createJSONResponse({}, false))
        )

        const { container } = render(<HookTest />)
        await flushPromises()

        expect(container.querySelector('[data-testid="count"]')?.textContent).toBe("0")
    })
})

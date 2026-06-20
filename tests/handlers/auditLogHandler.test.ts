import { describe, expect, it, vi } from "vitest"

import { createAuditLogHandler } from "../../src/handlers/auditLogHandler.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"

describe("auditLogHandler", () => {
    it("rejects anonymous users", async () => {
        const handler = createAuditLogHandler({ changeLogCollection: "payload-ai-auditlog" })
        const response = await handler(createMockRequest({ user: null }))

        expect(response.status).toBe(401)
        await expect(readJSON(response)).resolves.toEqual({ error: "Unauthorized" })
    })

    it("loads the latest 10 audit log entries and maps fields for the UI", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [
                {
                    action: "update",
                    additions: 3,
                    after: { title: "New" },
                    before: { title: "Old" },
                    collection: "posts",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    documentID: "4",
                    inputTokens: 20,
                    outputTokens: 10,
                    prompt: "Update title",
                    removals: 1,
                    targetType: "collection",
                    targetURL: "/admin/collections/posts/4",
                    title: "Updated post",
                    totalTokens: 30,
                    userID: "user-1",
                    userLabel: "Ada",
                },
            ],
        })
        const handler = createAuditLogHandler({ changeLogCollection: "payload-ai-auditlog" })
        const req = createMockRequest({ find })
        const response = await handler(req)

        expect(find).toHaveBeenCalledWith({
            collection: "payload-ai-auditlog",
            depth: 0,
            limit: 10,
            overrideAccess: false,
            req,
            sort: "-createdAt",
        })
        await expect(readJSON(response)).resolves.toEqual({
            changes: [
                {
                    action: "update",
                    additions: 3,
                    after: { title: "New" },
                    aiResponse: null,
                    before: { title: "Old" },
                    collection: "posts",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    documentID: "4",
                    inputTokens: 20,
                    outputTokens: 10,
                    prompt: "Update title",
                    removals: 1,
                    slug: null,
                    targetType: "collection",
                    title: "Updated post",
                    totalTokens: 30,
                    url: "/admin/collections/posts/4",
                    userID: "user-1",
                    userLabel: "Ada",
                },
            ],
        })
    })
})

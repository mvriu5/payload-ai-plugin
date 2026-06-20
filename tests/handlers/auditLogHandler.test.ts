import { describe, expect, it, vi } from "vitest"

import { createAuditLogHandler } from "../../src/handlers/auditLogHandler.js"
import { auditLogEntryJupiter } from "../fixtures/docs.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"
import { auditLogCollectionSlug } from "../fixtures/payloadConfig.js"

describe("auditLogHandler", () => {
    it("rejects anonymous users", async () => {
        const handler = createAuditLogHandler({ changeLogCollection: auditLogCollectionSlug })
        const response = await handler(createMockRequest({ user: null }))

        expect(response.status).toBe(401)
        await expect(readJSON(response)).resolves.toEqual({ error: "Unauthorized" })
    })

    it("loads the latest 10 audit log entries and maps fields for the UI", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [auditLogEntryJupiter],
        })
        const handler = createAuditLogHandler({ changeLogCollection: auditLogCollectionSlug })
        const req = createMockRequest({ find })
        const response = await handler(req)

        expect(find).toHaveBeenCalledWith({
            collection: auditLogCollectionSlug,
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
                    after: auditLogEntryJupiter.after,
                    aiResponse: null,
                    before: auditLogEntryJupiter.before,
                    collection: "posts",
                    createdAt: "2026-01-01T00:00:00.000Z",
                    documentID: "4",
                    inputTokens: 20,
                    outputTokens: 10,
                    prompt: "Update Jupiter",
                    removals: 1,
                    slug: null,
                    targetType: "collection",
                    title: "Updated Jupiter",
                    totalTokens: 30,
                    url: "/admin/collections/posts/4",
                    userID: "user-1",
                    userLabel: "Ada",
                },
            ],
        })
    })
})

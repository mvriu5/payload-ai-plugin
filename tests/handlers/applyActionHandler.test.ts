import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { signAIActionProposal } from "../../src/ai/proposalSigning.js"
import { createApplyActionHandler } from "../../src/handlers/applyActionHandler.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"

const originalPayloadSecret = process.env.PAYLOAD_SECRET

const postsCollection = {
    fields: [
        {
            name: "title",
            type: "text",
        },
    ],
    slug: "posts",
}

describe("applyActionHandler", () => {
    beforeEach(() => {
        process.env.PAYLOAD_SECRET = "test-secret"
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    })

    afterEach(() => {
        process.env.PAYLOAD_SECRET = originalPayloadSecret
        vi.useRealTimers()
    })

    it("rejects anonymous users", async () => {
        const handler = createApplyActionHandler()
        const response = await handler(createMockRequest({ user: null }))

        expect(response.status).toBe(401)
        await expect(readJSON(response)).resolves.toEqual({ error: "Unauthorized" })
    })

    it("rejects unsigned proposals before writing anything", async () => {
        const create = vi.fn()
        const update = vi.fn()
        const handler = createApplyActionHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    proposal: {
                        action: "update",
                        collection: "posts",
                        data: {
                            title: "Jupiter",
                        },
                        id: "4",
                        label: "Update post",
                    },
                },
                create,
                update,
            })
        )

        expect(response.status).toBe(400)
        expect(create).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toEqual({ error: "Proposal signature is invalid or expired." })
    })

    it("applies signed collection updates and writes an audit log entry through mocks only", async () => {
        const proposal = signAIActionProposal({
            action: "update",
            collection: "posts",
            data: {
                title: "Jupiter",
            },
            id: "4",
            label: "Update post",
        })
        const findByID = vi.fn().mockResolvedValue({
            id: "4",
            title: "Old title",
        })
        const update = vi.fn().mockResolvedValue({
            id: "4",
        })
        const create = vi.fn().mockResolvedValue({
            id: "audit-1",
        })
        const handler = createApplyActionHandler({ changeLogCollection: "payload-ai-auditlog" })
        const req = createMockRequest({
            body: {
                aiResponse: "Prepared update",
                prompt: "Make title Jupiter",
                proposal,
                tokenUsage: {
                    inputTokens: 10,
                    outputTokens: 5,
                    totalTokens: 15,
                },
            },
            collections: [postsCollection],
            create,
            findByID,
            update,
            user: {
                email: "ada@example.com",
                id: "user-1",
            },
        })
        const response = await handler(req)

        expect(findByID).toHaveBeenCalledWith({
            collection: "posts",
            depth: 2,
            id: "4",
            req,
        })
        expect(update).toHaveBeenCalledWith({
            collection: "posts",
            data: {
                title: "Jupiter",
            },
            id: "4",
            overrideAccess: false,
            req,
        })
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "payload-ai-auditlog",
                data: expect.objectContaining({
                    action: "update",
                    after: {
                        id: "4",
                        title: "Jupiter",
                    },
                    before: {
                        id: "4",
                        title: "Old title",
                    },
                    collection: "posts",
                    documentID: "4",
                    inputTokens: 10,
                    outputTokens: 5,
                    prompt: "Make title Jupiter",
                    targetURL: "/admin/collections/posts/4",
                    title: "Update post",
                    totalTokens: 15,
                    userID: "user-1",
                    userLabel: "ada@example.com",
                }),
                overrideAccess: true,
                req,
            })
        )
        await expect(readJSON(response)).resolves.toMatchObject({
            doc: {
                id: "4",
            },
            status: "applied",
        })
    })

    it("applies signed deletes with mocked payload delete", async () => {
        const proposal = signAIActionProposal({
            action: "delete",
            collection: "posts",
            id: "4",
            label: "Delete post",
        })
        const deleteOperation = vi.fn().mockResolvedValue({
            id: "4",
            title: "Old title",
        })
        const handler = createApplyActionHandler()
        const req = createMockRequest({
            body: {
                proposal,
            },
            collections: [postsCollection],
            delete: deleteOperation,
        })
        const response = await handler(req)

        expect(deleteOperation).toHaveBeenCalledWith({
            collection: "posts",
            id: "4",
            overrideAccess: false,
            req,
        })
        await expect(readJSON(response)).resolves.toEqual({
            change: null,
            doc: {
                id: "4",
            },
            status: "applied",
        })
    })

    it("rejects sensitive proposal payloads without applying them", async () => {
        const proposal = signAIActionProposal({
            action: "update",
            collection: "posts",
            data: {
                apiKey: "secret",
            },
            id: "4",
            label: "Update post",
        })
        const update = vi.fn()
        const handler = createApplyActionHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    proposal,
                },
                collections: [postsCollection],
                update,
            })
        )

        expect(response.status).toBe(400)
        expect(update).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toEqual({ error: "Proposal contains sensitive fields and cannot be applied." })
    })
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createApplyActionHandler } from "../../src/handlers/applyActionHandler.js"
import { oldPostJupiter, postJupiter } from "../fixtures/docs.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"
import { auditLogCollectionSlug, postsCollection } from "../fixtures/payloadConfig.js"
import { signedDeletePostProposal, signedSensitiveUpdatePostProposal, signedUpdatePostProposal, unsignedUpdatePostProposal } from "../fixtures/proposals.js"

const originalPayloadSecret = process.env.PAYLOAD_SECRET

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
        await expect(readJSON(response)).resolves.toMatchObject({
            debug: {
                phase: "authorization",
                reason: "unauthorized",
            },
            error: "Unauthorized",
        })
    })

    it("rejects unsigned proposals before writing anything", async () => {
        const create = vi.fn()
        const update = vi.fn()
        const handler = createApplyActionHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    proposal: {
                        ...unsignedUpdatePostProposal(),
                    },
                },
                create,
                update,
            })
        )

        expect(response.status).toBe(400)
        expect(create).not.toHaveBeenCalled()
        expect(update).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toMatchObject({
            debug: {
                action: "update",
                collection: "posts",
                id: "4",
                phase: "apply_validation",
                reason: "invalid_signature",
            },
            error: "Proposal signature is invalid or expired.",
        })
    })

    it("applies signed collection updates and writes an audit log entry through mocks only", async () => {
        const proposal = signedUpdatePostProposal()
        const findByID = vi.fn().mockResolvedValue(oldPostJupiter)
        const update = vi.fn().mockResolvedValue({
            id: postJupiter.id,
        })
        const create = vi.fn().mockResolvedValue({
            id: "audit-1",
        })
        const handler = createApplyActionHandler({ changeLogCollection: auditLogCollectionSlug })
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
            id: postJupiter.id,
            req,
        })
        expect(update).toHaveBeenCalledWith({
            collection: "posts",
            data: {
                title: "Jupiter",
            },
            id: postJupiter.id,
            overrideAccess: false,
            req,
        })
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: auditLogCollectionSlug,
                data: expect.objectContaining({
                    action: "update",
                    after: {
                        id: "4",
                        slug: "jupiter",
                        title: "Jupiter",
                    },
                    before: {
                        id: "4",
                        slug: "jupiter",
                        title: "Old Jupiter",
                    },
                    collection: "posts",
                    documentID: "4",
                    inputTokens: 10,
                    outputTokens: 5,
                    prompt: "Make title Jupiter",
                    targetURL: "/admin/collections/posts/4",
                    title: "Update Jupiter",
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
        const proposal = signedDeletePostProposal()
        const deleteOperation = vi.fn().mockResolvedValue(oldPostJupiter)
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
        const proposal = signedSensitiveUpdatePostProposal()
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
        await expect(readJSON(response)).resolves.toMatchObject({
            debug: {
                action: "update",
                collection: "posts",
                id: "4",
                phase: "apply_validation",
                reason: "sensitive_data_in_data",
            },
            error: "Proposal contains sensitive fields and cannot be applied.",
        })
    })
})

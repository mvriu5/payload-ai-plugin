import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { signAIActionProposal } from "../../src/ai/proposalSigning.js"
import { createProposalDiffHandler } from "../../src/handlers/proposalDiffHandler.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"

const originalPayloadSecret = process.env.PAYLOAD_SECRET

const postsCollection = {
    fields: [
        {
            name: "title",
            type: "text",
        },
        {
            name: "apiKey",
            type: "text",
        },
    ],
    slug: "posts",
}

describe("proposalDiffHandler", () => {
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
        const handler = createProposalDiffHandler()
        const response = await handler(createMockRequest({ user: null }))

        expect(response.status).toBe(401)
        await expect(readJSON(response)).resolves.toEqual({ error: "Unauthorized" })
    })

    it("rejects missing and unsigned proposals", async () => {
        const handler = createProposalDiffHandler()

        const missingResponse = await handler(createMockRequest({ body: {} }))
        expect(missingResponse.status).toBe(400)
        await expect(readJSON(missingResponse)).resolves.toEqual({ error: "Proposal is required" })

        const unsignedResponse = await handler(
            createMockRequest({
                body: {
                    proposal: {
                        action: "update",
                        collection: "posts",
                        data: {
                            title: "New",
                        },
                        id: "4",
                        label: "Update post",
                    },
                },
            })
        )
        expect(unsignedResponse.status).toBe(400)
        await expect(readJSON(unsignedResponse)).resolves.toEqual({ error: "Proposal signature is invalid or expired." })
    })

    it("builds before and after state for signed collection updates", async () => {
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
            apiKey: "secret",
            id: "4",
            slug: "jupiter",
            title: "Old title",
        })
        const handler = createProposalDiffHandler()
        const req = createMockRequest({
            body: {
                proposal,
            },
            collections: [postsCollection],
            findByID,
        })
        const response = await handler(req)

        expect(findByID).toHaveBeenCalledWith({
            collection: "posts",
            depth: 2,
            id: "4",
            overrideAccess: false,
            req,
        })
        await expect(readJSON(response)).resolves.toEqual({
            after: {
                apiKey: "[redacted]",
                id: "4",
                slug: "jupiter",
                title: "Jupiter",
            },
            before: {
                apiKey: "[redacted]",
                id: "4",
                slug: "jupiter",
                title: "Old title",
            },
        })
    })

    it("honors collection read permissions", async () => {
        const proposal = signAIActionProposal({
            action: "update",
            collection: "posts",
            data: {
                title: "Jupiter",
            },
            id: "4",
            label: "Update post",
        })
        const handler = createProposalDiffHandler({
            collections: {
                posts: {
                    create: false,
                    delete: false,
                    read: false,
                    update: false,
                },
            },
        })
        const response = await handler(
            createMockRequest({
                body: {
                    proposal,
                },
                collections: [postsCollection],
            })
        )

        expect(response.status).toBe(400)
        await expect(readJSON(response)).resolves.toEqual({ error: "Unknown collection" })
    })
})

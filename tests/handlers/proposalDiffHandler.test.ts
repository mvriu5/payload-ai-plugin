import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createProposalDiffHandler } from "../../src/handlers/proposalDiffHandler.js"
import { sensitivePostJupiter } from "../fixtures/docs.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"
import { postsCollection } from "../fixtures/payloadConfig.js"
import { signedUpdatePostProposal, unsignedUpdatePostProposal } from "../fixtures/proposals.js"

const originalPayloadSecret = process.env.PAYLOAD_SECRET

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
                        ...unsignedUpdatePostProposal({ title: "New" }),
                    },
                },
            })
        )
        expect(unsignedResponse.status).toBe(400)
        await expect(readJSON(unsignedResponse)).resolves.toEqual({ error: "Proposal signature is invalid or expired." })
    })

    it("builds before and after state for signed collection updates", async () => {
        const proposal = signedUpdatePostProposal()
        const findByID = vi.fn().mockResolvedValue(sensitivePostJupiter)
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
                title: "Old Jupiter",
            },
        })
    })

    it("honors collection read permissions", async () => {
        const proposal = signedUpdatePostProposal()
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

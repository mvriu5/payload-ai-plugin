import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { signAIActionProposal, verifyActionProposal } from "../../../src/ai/proposalSigning.js"
import { signedDeletePostProposal, signedUpdatePostProposal, unsignedUpdatePostProposal } from "../../fixtures/proposals.js"

const originalPayloadSecret = process.env.PAYLOAD_SECRET

describe("proposal signing", () => {
    beforeEach(() => {
        process.env.PAYLOAD_SECRET = "test-secret"
        vi.useFakeTimers()
        vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"))
    })

    afterEach(() => {
        process.env.PAYLOAD_SECRET = originalPayloadSecret
        vi.useRealTimers()
    })

    it("signs and verifies a proposal", () => {
        const signed = signedUpdatePostProposal()

        expect(signed._aiSignature.value).toMatch(/^[a-f0-9]{64}$/)
        expect(verifyActionProposal(signed)).toBe(true)
    })

    it("does not depend on object key order", () => {
        const signed = signedUpdatePostProposal()

        expect(
            verifyActionProposal({
                _aiSignature: signed._aiSignature,
                collection: "posts",
                label: "Update Jupiter",
                action: "update",
                id: "4",
                data: {
                    title: "Jupiter",
                },
            })
        ).toBe(true)
    })

    it("rejects manipulated proposals", () => {
        const signed = signedUpdatePostProposal()

        expect(
            verifyActionProposal({
                ...signed,
                data: {
                    title: "Saturn",
                },
            })
        ).toBe(false)
    })

    it("rejects expired signatures", () => {
        const signed = signedDeletePostProposal()

        vi.setSystemTime(new Date("2026-01-01T00:11:00.000Z"))

        expect(verifyActionProposal(signed)).toBe(false)
    })

    it("requires PAYLOAD_SECRET", () => {
        delete process.env.PAYLOAD_SECRET

        expect(() => signAIActionProposal(unsignedUpdatePostProposal())).toThrow("PAYLOAD_SECRET is required to sign AI proposals.")
    })
})

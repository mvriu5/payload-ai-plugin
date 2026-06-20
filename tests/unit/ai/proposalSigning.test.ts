import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { signAIActionProposal, verifyActionProposal } from "../../../src/ai/proposalSigning.js"

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
        const signed = signAIActionProposal({
            action: "update",
            collection: "posts",
            data: {
                title: "Jupiter",
            },
            id: "1",
            label: "Update post",
        })

        expect(signed._aiSignature.value).toMatch(/^[a-f0-9]{64}$/)
        expect(verifyActionProposal(signed)).toBe(true)
    })

    it("does not depend on object key order", () => {
        const signed = signAIActionProposal({
            action: "update",
            collection: "posts",
            data: {
                title: "Jupiter",
            },
            id: "1",
            label: "Update post",
        })

        expect(
            verifyActionProposal({
                _aiSignature: signed._aiSignature,
                collection: "posts",
                label: "Update post",
                action: "update",
                id: "1",
                data: {
                    title: "Jupiter",
                },
            })
        ).toBe(true)
    })

    it("rejects manipulated proposals", () => {
        const signed = signAIActionProposal({
            action: "update",
            collection: "posts",
            data: {
                title: "Jupiter",
            },
            id: "1",
            label: "Update post",
        })

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
        const signed = signAIActionProposal({
            action: "delete",
            collection: "posts",
            id: "1",
            label: "Delete post",
        })

        vi.setSystemTime(new Date("2026-01-01T00:11:00.000Z"))

        expect(verifyActionProposal(signed)).toBe(false)
    })

    it("requires PAYLOAD_SECRET", () => {
        delete process.env.PAYLOAD_SECRET

        expect(() =>
            signAIActionProposal({
                action: "delete",
                collection: "posts",
                id: "1",
                label: "Delete post",
            })
        ).toThrow("PAYLOAD_SECRET is required to sign AI proposals.")
    })
})

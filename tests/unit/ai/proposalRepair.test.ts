import { describe, expect, it } from "vitest"

import { compactProposalRepairIssues, createProposalRepairKey, createProposalRepairTracker } from "../../../src/ai/proposalRepair.js"

describe("proposalRepair", () => {
    it("compacts validation issues into bounded repair instructions", () => {
        const issues = compactProposalRepairIssues([
            {
                code: "unknown_field",
                message: "Unknown field.",
                path: "unknown",
            },
            {
                code: "invalid_option",
                message: "Field must use one of: draft, published.",
                path: "status",
            },
        ])

        expect(issues).toEqual([
            {
                code: "unknown_field",
                hint: "Remove it and use exact schema field names only.",
                path: "unknown",
            },
            {
                code: "invalid_option",
                hint: "Field must use one of: draft, published.",
                path: "status",
            },
        ])
    })

    it("allows one repair call and blocks subsequent calls for the same target", () => {
        const tracker = createProposalRepairTracker()
        const target = {
            collection: "posts",
            id: "post-1",
            tool: "proposeUpdateDoc",
        }

        expect(tracker.beginCall(target)).toBe("initial")
        expect(tracker.registerFailure(target)).toMatchObject({
            attempt: 1,
            errorCode: "INVALID_PROPOSAL_DATA",
            retryable: true,
        })
        expect(tracker.beginCall(target)).toBe("repair")
        expect(tracker.registerFailure(target)).toMatchObject({
            errorCode: "REPAIR_EXHAUSTED",
            retryable: false,
        })
        expect(tracker.beginCall(target)).toBe("blocked")
    })

    it("tracks different proposal targets independently", () => {
        const tracker = createProposalRepairTracker()
        const firstTarget = {
            collection: "posts",
            id: "post-1",
            tool: "proposeUpdateDoc",
        }
        const secondTarget = {
            collection: "posts",
            id: "post-2",
            tool: "proposeUpdateDoc",
        }

        tracker.registerFailure(firstTarget)

        expect(tracker.beginCall(firstTarget)).toBe("repair")
        expect(tracker.beginCall(secondTarget)).toBe("initial")
        expect(createProposalRepairKey(firstTarget)).not.toBe(createProposalRepairKey(secondTarget))
    })
})

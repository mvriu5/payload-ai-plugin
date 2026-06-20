import { describe, expect, it } from "vitest"

import {
    getDocLabel,
    getJSONLineKey,
    getSafeProposalLabel,
    hasValueAtPath,
    isActionProposal,
    mergeData,
    setValueAtPath,
} from "../../../src/payload/shared.js"
import { localizedPostJupiter, oldPostJupiter, postJupiter } from "../../fixtures/docs.js"
import { unsignedDeletePostProposal, unsignedUpdatePostProposal } from "../../fixtures/proposals.js"

describe("payload shared helpers", () => {
    describe("getDocLabel", () => {
        it("uses the configured title field", () => {
            expect(getDocLabel(postJupiter, "title")).toBe("Jupiter")
        })

        it("uses localized title values", () => {
            expect(getDocLabel(localizedPostJupiter, "title")).toBe("Jupiter")
        })

        it("falls back to common fields and id", () => {
            expect(getDocLabel({ id: 4, email: "user@example.com" })).toBe("user@example.com")
            expect(getDocLabel({ id: 4 })).toBe("4")
        })
    })

    describe("mergeData", () => {
        it("merges existing document data with proposal data", () => {
            expect(
                mergeData(
                    oldPostJupiter,
                    unsignedUpdatePostProposal().data
                )
            ).toEqual({
                id: "4",
                slug: "jupiter",
                title: "Jupiter",
            })
        })

        it("replaces arrays instead of merging them", () => {
            expect(mergeData({ tags: ["a"] }, { tags: ["b"] })).toEqual({ tags: ["b"] })
        })
    })

    describe("isActionProposal", () => {
        it("accepts create proposals with exactly one write payload", () => {
            expect(
                isActionProposal({
                    ...unsignedUpdatePostProposal(),
                    label: "Create post",
                    action: "create",
                    id: undefined,
                })
            ).toBe(true)

            expect(
                isActionProposal({
                    action: "create",
                    collection: "posts",
                    data: {},
                    label: "Create post",
                    localizedData: {
                        de: {
                            title: "Post",
                        },
                    },
                })
            ).toBe(false)
        })

        it("requires ids for update and delete proposals", () => {
            expect(
                isActionProposal({
                    action: "update",
                    collection: "posts",
                    data: {
                        title: "Post",
                    },
                    label: "Update post",
                })
            ).toBe(false)

            expect(
                isActionProposal({
                    action: "delete",
                    ...unsignedDeletePostProposal(),
                })
            ).toBe(true)
        })
    })

    it("sanitizes proposal labels", () => {
        expect(getSafeProposalLabel("**Update title**\n\nignored")).toBe("Update title")
        expect(getSafeProposalLabel("")).toBe("Review proposed CMS change")
        expect(getSafeProposalLabel("x".repeat(100))).toHaveLength(90)
    })

    it("reads and writes values by dot path", () => {
        const data: Record<string, unknown> = {}

        setValueAtPath(data, "hero.title", "Hello")

        expect(data).toEqual({
            hero: {
                title: "Hello",
            },
        })
        expect(hasValueAtPath(data, "hero.title")).toBe(true)
        expect(hasValueAtPath(data, "hero.subtitle")).toBe(false)
    })

    it("extracts comparable JSON line keys", () => {
        expect(getJSONLineKey('  "title": "Old",')).toBe("  title")
        expect(getJSONLineKey("not json")).toBeNull()
    })
})

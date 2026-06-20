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

describe("payload shared helpers", () => {
    describe("getDocLabel", () => {
        it("uses the configured title field", () => {
            expect(getDocLabel({ id: 1, headline: "Home" }, "headline")).toBe("Home")
        })

        it("uses localized title values", () => {
            expect(getDocLabel({ id: 1, title: { de: "Jupiter", en: "Jupiter EN" } }, "title")).toBe("Jupiter")
        })

        it("falls back to common fields and id", () => {
            expect(getDocLabel({ id: 4, email: "user@example.com" })).toBe("user@example.com")
            expect(getDocLabel({ id: 4 })).toBe("4")
        })
    })

    describe("mergeData", () => {
        it("deep merges records without replacing nested objects", () => {
            expect(
                mergeData(
                    {
                        hero: {
                            title: "Old",
                            visible: true,
                        },
                        slug: "home",
                    },
                    {
                        hero: {
                            title: "New",
                        },
                    }
                )
            ).toEqual({
                hero: {
                    title: "New",
                    visible: true,
                },
                slug: "home",
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
                    action: "create",
                    collection: "posts",
                    data: {
                        title: "Post",
                    },
                    label: "Create post",
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
                    collection: "posts",
                    id: "1",
                    label: "Delete post",
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

import { describe, expect, it } from "vitest"

import {
    createToolFieldNamesSchema,
    getToolSelectableFieldNames,
    maxToolSelectedFields,
    resolveToolFieldSelection,
} from "../../../src/payload/toolFieldSelection.js"

const collection = {
    admin: {
        useAsTitle: "title",
    },
    fields: [
        { name: "title", type: "text" },
        { name: "slug", type: "text" },
        { name: "summary", type: "textarea" },
        { name: "content", type: "richText" },
        { name: "layout", type: "blocks" },
        { name: "author", relationTo: "users", type: "relationship" },
        { name: "apiKey", type: "text" },
    ],
    slug: "posts",
}

describe("toolFieldSelection", () => {
    it("uses compact identity fields by default", () => {
        const selection = resolveToolFieldSelection({
            config: collection,
        })

        expect(selection.fields).toEqual(["title", "slug", "updatedAt"])
        expect(selection.select).toEqual({
            slug: true,
            title: true,
            updatedAt: true,
        })
        expect(selection.depth).toBe(0)
        expect(selection.fields).not.toContain("content")
        expect(selection.fields).not.toContain("layout")
        expect(selection.fields).not.toContain("summary")
    })

    it("loads explicitly selected large and relationship fields", () => {
        const selection = resolveToolFieldSelection({
            config: collection,
            requestedFields: ["content", "layout", "author"],
        })

        expect(selection.select).toEqual({
            author: true,
            content: true,
            layout: true,
        })
        expect(selection.depth).toBe(1)
        expect(selection.invalidFields).toEqual([])
    })

    it("rejects unknown and sensitive field names", () => {
        const selection = resolveToolFieldSelection({
            config: collection,
            requestedFields: ["title", "apiKey", "unknown"],
        })

        expect(selection.fields).toEqual(["title"])
        expect(selection.invalidFields).toEqual(["apiKey", "unknown"])
        expect(getToolSelectableFieldNames(collection)).not.toContain("apiKey")
    })

    it("provides upload metadata defaults", () => {
        const selection = resolveToolFieldSelection({
            config: {
                fields: [{ name: "alt", type: "text" }],
                slug: "media",
                upload: true,
            },
        })

        expect(selection.fields).toEqual(["alt", "updatedAt", "filename", "mimeType", "filesize", "url"])
    })

    it("exposes a bounded enum schema to read tools", () => {
        const schema = createToolFieldNamesSchema([collection])

        expect(schema.safeParse(["title", "content"]).success).toBe(true)
        expect(schema.safeParse(["apiKey"]).success).toBe(false)
        expect(schema.safeParse(Array.from({ length: maxToolSelectedFields + 1 }, () => "title")).success).toBe(false)
    })
})

import { describe, expect, it } from "vitest"
import { createLocalizedPayloadDataSchema, createPayloadDataSchema, genericPayloadDataSchema } from "../../../src/payload/toolSchemas.js"

const collection = {
    fields: [
        {
            name: "title",
            required: true,
            type: "text",
        },
        {
            name: "rating",
            type: "number",
        },
        {
            hasMany: true,
            name: "categories",
            options: ["news", "guide"],
            type: "select",
        },
        {
            name: "author",
            relationTo: "users",
            type: "relationship",
        },
        {
            name: "seo",
            type: "group",
            fields: [{ name: "description", type: "textarea" }],
        },
        {
            name: "links",
            type: "array",
            fields: [
                { name: "label", type: "text" },
                { name: "url", type: "text" },
            ],
        },
        {
            blocks: [
                {
                    fields: [{ name: "headline", type: "text" }],
                    slug: "hero",
                },
                {
                    fields: [{ name: "body", type: "textarea" }],
                    slug: "copy",
                },
            ],
            name: "layout",
            type: "blocks",
        },
        {
            fields: [{ name: "featured", type: "checkbox" }],
            type: "row",
        },
    ],
    slug: "posts",
    versions: {
        drafts: true,
    },
}

describe("toolSchemas", () => {
    it("creates a strict partial data schema from Payload fields", () => {
        const schema = createPayloadDataSchema(collection)
        const result = schema.safeParse({
            _status: "draft",
            author: "user-1",
            categories: ["news"],
            featured: true,
            layout: [
                {
                    blockType: "hero",
                    headline: "Welcome",
                },
            ],
            links: [{ label: "Docs", url: "/docs" }],
            rating: 5,
            seo: {
                description: "Description",
            },
            title: "Post",
        })

        expect(result.success).toBe(true)
    })

    it.each([
        [{ unknown: true }, "unknown fields"],
        [{ rating: "five" }, "incorrect field types"],
        [{ categories: ["invalid"] }, "invalid select values"],
        [{ layout: [{ blockType: "unknown" }] }, "invalid block types"],
        [{ seo: { unknown: true } }, "unknown nested fields"],
    ])("rejects %s", (data) => {
        expect(createPayloadDataSchema(collection).safeParse(data).success).toBe(false)
    })

    it("supports polymorphic and many relationships", () => {
        const schema = createPayloadDataSchema({
            fields: [
                {
                    hasMany: true,
                    name: "related",
                    relationTo: ["posts", "pages"],
                    type: "relationship",
                },
            ],
            slug: "links",
        })

        expect(
            schema.safeParse({
                related: [
                    "post-1",
                    {
                        relationTo: "pages",
                        value: 2,
                    },
                ],
            }).success
        ).toBe(true)
        expect(schema.safeParse({ related: [{ relationTo: "media", value: "1" }] }).success).toBe(false)
    })

    it("uses the same collection schema for each locale", () => {
        const schema = createLocalizedPayloadDataSchema(createPayloadDataSchema(collection))

        expect(schema.safeParse({ de: { title: "Titel" }, en: { title: "Title" } }).success).toBe(true)
        expect(schema.safeParse({ de: { missing: "field" } }).success).toBe(false)
        expect(schema.safeParse({}).success).toBe(false)
    })

    it("keeps a generic fallback when no target schema is known", () => {
        expect(genericPayloadDataSchema.safeParse({ arbitrary: { value: true } }).success).toBe(true)
        expect(createPayloadDataSchema().safeParse({ arbitrary: true }).success).toBe(true)
    })
})

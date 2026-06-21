import { describe, expect, it } from "vitest"

import { prepareProposalWriteData } from "../../../src/payload/proposalData.js"

const pageCollection = {
    admin: {
        useAsTitle: "title",
    },
    fields: [
        {
            localized: true,
            name: "title",
            required: true,
            type: "text",
        },
        {
            defaultValue: "draft",
            name: "status",
            options: ["draft", "published"],
            required: true,
            type: "select",
        },
        {
            fields: [
                {
                    name: "label",
                    required: true,
                    type: "text",
                },
            ],
            name: "items",
            type: "array",
        },
        {
            blocks: [
                {
                    fields: [
                        {
                            name: "copy",
                            required: true,
                            type: "text",
                        },
                    ],
                    slug: "hero",
                },
            ],
            name: "layout",
            type: "blocks",
        },
        {
            name: "category",
            options: ["news", "guide"],
            required: true,
            type: "radio",
        },
        {
            name: "author",
            relationTo: "users",
            type: "relationship",
        },
        {
            hasMany: true,
            name: "relatedPosts",
            relationTo: "posts",
            type: "relationship",
        },
    ],
    slug: "pages",
    versions: {
        drafts: true,
    },
} as const

const optionalStatusCollection = {
    admin: {
        useAsTitle: "title",
    },
    fields: [
        {
            name: "title",
            required: true,
            type: "text",
        },
        {
            defaultValue: "draft",
            name: "status",
            options: ["draft", "published"],
            type: "select",
        },
    ],
    slug: "posts",
} as const

describe("prepareProposalWriteData", () => {
    it("fills title and defaults for create proposals", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
            },
            label: "Create a Mars page",
            mode: "create",
        })

        expect(result.issues).toEqual([])
        expect(result.data).toMatchObject({
            _status: "draft",
            category: "news",
            status: "draft",
            title: "Create a Mars page",
        })
    })

    it("prefers explicit select values from the prompt over schema defaults", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
            },
            inferenceText: "Create a Mars page and set the status to published.",
            label: "Create a Mars page",
            mode: "create",
        })

        expect(result.issues).toEqual([])
        expect(result.data).toMatchObject({
            status: "published",
        })
    })

    it("overrides conflicting select values when the prompt explicitly requests another valid option", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
                status: "draft",
            },
            inferenceText: "Create a Mars page and set the status to published.",
            label: "Create a Mars page",
            mode: "create",
        })

        expect(result.issues).toEqual([])
        expect(result.data).toMatchObject({
            status: "published",
        })
        expect(result.coercedFields).toContain("status")
    })

    it("uses inferenceText when the model label omits the requested select value", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
                status: "draft",
            },
            inferenceText: "Create a post about Animals and set the status to published.",
            label: "Create Animals post",
            mode: "create",
        })

        expect(result.issues).toEqual([])
        expect(result.data).toMatchObject({
            status: "published",
        })
    })

    it("fills missing optional select fields from an explicit prompt request", () => {
        const result = prepareProposalWriteData({
            collectionConfig: optionalStatusCollection,
            data: {
                title: "Animals",
            },
            inferenceText: "Create a post about Animals and set the status to published.",
            label: "Create Animals post",
            mode: "create",
        })

        expect(result.issues).toEqual([])
        expect(result.data).toMatchObject({
            status: "published",
            title: "Animals",
        })
        expect(result.coercedFields).toContain("status")
    })

    it("rejects invalid select or radio values", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "invalid",
                title: "Mars",
            },
            label: "Create a Mars page",
            mode: "create",
        })

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "invalid_option",
                    path: "category",
                }),
            ])
        )
    })

    it("rejects non-localized fields in secondary locales", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            label: "Translate Mars page",
            localizedData: {
                de: {
                    category: "news",
                    status: "draft",
                    title: "Mars",
                },
                en: {
                    category: "guide",
                    title: "Mars EN",
                },
            },
            mode: "create",
        })

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "non_localized_field_in_secondary_locale",
                    path: "localizedData.en.category",
                }),
            ])
        )
    })

    it("validates block shape and required block fields", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
                layout: [{ blockType: "hero" }],
                title: "Mars",
            },
            label: "Create a Mars page",
            mode: "create",
        })

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "missing_required_field",
                    path: "layout.0.copy",
                }),
            ])
        )
    })

    it("rejects unknown block types with a block-specific issue", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
                layout: [{ blockType: "heroBanner" }],
                title: "Mars",
            },
            label: "Create a Mars page",
            mode: "create",
        })

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "invalid_block_type",
                    path: "layout.0.blockType",
                }),
            ])
        )
    })

    it("rejects free text in relationship fields", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                author: "Ada Lovelace",
                category: "news",
                title: "Mars",
            },
            label: "Create a Mars page",
            mode: "create",
        })

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "invalid_relationship",
                    path: "author",
                }),
            ])
        )
    })

    it("rejects invalid hasMany relationship ids", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
                relatedPosts: [28, 0],
                title: "Mars",
            },
            label: "Update Mars page",
            mode: "update",
        })

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "invalid_relationship",
                    path: "relatedPosts.1",
                }),
            ])
        )
    })

    it("rejects unknown fields on update proposals", () => {
        const result = prepareProposalWriteData({
            collectionConfig: pageCollection,
            data: {
                category: "news",
                unknownField: "value",
            },
            label: "Update Mars page",
            mode: "update",
        })

        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    code: "unknown_field",
                    path: "unknownField",
                }),
            ])
        )
    })
})

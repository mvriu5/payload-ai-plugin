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
    ],
    slug: "pages",
    versions: {
        drafts: true,
    },
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

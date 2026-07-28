import { describe, expect, it } from "vitest"

import { addTextGenerationFields } from "../../../src/payload/textFieldGeneration.js"

describe("textFieldGeneration", () => {
    it("indexes text, textarea, rich text, and JSON fields and preserves existing afterInput components", () => {
        const fields = [
            {
                admin: {
                    components: {
                        afterInput: ["example/client#Existing"],
                    },
                    description: "Main headline",
                },
                label: "Title",
                maxLength: 80,
                name: "title",
                type: "text",
            },
            {
                fields: [
                    {
                        name: "summary",
                        type: "textarea",
                    },
                ],
                name: "seo",
                type: "group",
            },
            {
                label: "Body",
                name: "body",
                type: "richText",
            },
            {
                label: "Metadata",
                name: "metadata",
                type: "json",
            },
            {
                name: "count",
                type: "number",
            },
        ] as never

        const context = addTextGenerationFields({
            fields,
            label: "Post",
            slug: "posts",
            type: "collection",
        })

        expect(context.fields).toEqual([
            {
                description: "Main headline",
                fieldType: "text",
                hasMany: false,
                key: "posts.title",
                label: "Title",
                maxLength: 80,
                name: "title",
            },
            {
                description: undefined,
                fieldType: "textarea",
                hasMany: false,
                key: "posts.seo.summary",
                label: "summary",
                maxLength: undefined,
                name: "summary",
            },
            {
                description: undefined,
                fieldType: "richText",
                hasMany: false,
                key: "posts.body",
                label: "Body",
                maxLength: undefined,
                name: "body",
            },
            {
                description: undefined,
                fieldType: "json",
                hasMany: false,
                key: "posts.metadata",
                label: "Metadata",
                maxLength: undefined,
                name: "metadata",
            },
        ])
        expect(fields[0].admin.components.afterInput).toHaveLength(2)
        expect(fields[0].admin.components.afterInput[1]).toMatchObject({
            clientProps: {
                generationFieldKey: "posts.title",
                generationFieldType: "text",
            },
            path: "@mvriu5/payload-ai/client#GenerateField",
        })
        expect(fields[1].fields[0].admin.components.afterInput[0].clientProps.generationFieldType).toBe("textarea")
        expect(fields[2].admin.components.afterInput[0].clientProps.generationFieldType).toBe("richText")
        expect(fields[3].admin.components.afterInput[0].clientProps.generationFieldType).toBe("json")
    })

    it("records the nearest block schema for fields inside layout blocks", () => {
        const fields = [
            {
                blocks: [
                    {
                        fields: [
                            {
                                label: "Body",
                                name: "body",
                                type: "textarea",
                            },
                        ],
                        labels: {
                            plural: "Features",
                            singular: "Feature",
                        },
                        slug: "feature",
                    },
                ],
                name: "layout",
                type: "blocks",
            },
        ] as never

        const context = addTextGenerationFields({
            fields,
            label: "Post",
            slug: "posts",
            type: "collection",
        })

        expect(context.fields).toEqual([
            expect.objectContaining({
                block: {
                    label: "Feature",
                    slug: "feature",
                },
                key: "posts.layout.feature.body",
                name: "body",
            }),
        ])
    })
})

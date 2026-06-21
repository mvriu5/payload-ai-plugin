import { describe, expect, it } from "vitest"

import { describeCollectionLikeConfig } from "../../../src/payload/schemaContext.js"

describe("describeCollectionLikeConfig", () => {
    it("describes blocks fields with accepted block types and examples", () => {
        const result = describeCollectionLikeConfig({
            config: {
                fields: [
                    {
                        blocks: [
                            {
                                fields: [
                                    {
                                        name: "headline",
                                        required: true,
                                        type: "text",
                                    },
                                    {
                                        fields: [
                                            {
                                                name: "label",
                                                type: "text",
                                            },
                                        ],
                                        name: "links",
                                        type: "array",
                                    },
                                ],
                                labels: {
                                    singular: "Hero",
                                },
                                slug: "hero",
                            },
                        ],
                        name: "layout",
                        type: "blocks",
                    },
                ],
                slug: "pages",
            },
            type: "collection",
        })

        expect(result.fields).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    acceptedBlockTypes: ["hero"],
                    blockExample: [
                        {
                            blockType: "hero",
                            headline: "<headline>",
                            links: [{ label: "<label>" }],
                        },
                    ],
                    name: "layout",
                    type: "blocks",
                }),
            ])
        )

        expect(result.fields[0]).toEqual(
            expect.objectContaining({
                blocks: [
                    expect.objectContaining({
                        blockType: "hero",
                        example: {
                            blockType: "hero",
                            headline: "<headline>",
                            links: [{ label: "<label>" }],
                        },
                    }),
                ],
            })
        )
    })
})

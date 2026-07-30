import { describe, expect, it } from "vitest"

import { getTranslationValues, hasLocalizedFields } from "../../../../src/features/content/documentTranslation.js"

describe("documentTranslation", () => {
    const fields = [
        {
            localized: true,
            name: "title",
            type: "text",
        },
        {
            fields: [
                {
                    localized: true,
                    name: "caption",
                    type: "textarea",
                },
            ],
            name: "items",
            type: "array",
        },
        {
            name: "slug",
            type: "text",
        },
    ] as never

    it("collects localized values with dynamic array paths", () => {
        expect(
            getTranslationValues(fields, {
                items: [{ caption: "First" }, { caption: "Second" }],
                slug: "unchanged",
                title: "Hello",
            })
        ).toEqual([
            {
                fieldType: "text",
                path: "title",
                value: "Hello",
            },
            {
                fieldType: "textarea",
                path: "items.0.caption",
                value: "First",
            },
            {
                fieldType: "textarea",
                path: "items.1.caption",
                value: "Second",
            },
        ])
    })

    it("detects localized fields without document data", () => {
        expect(hasLocalizedFields(fields)).toBe(true)
        expect(hasLocalizedFields([{ name: "slug", type: "text" }] as never)).toBe(false)
    })

    it("does not treat an empty Lexical editor state as translated content", () => {
        const richTextFields = [{ localized: true, name: "content", type: "richText" }] as never
        const emptyLexicalState = {
            root: {
                children: [],
                direction: "ltr",
                format: "",
                indent: 0,
                type: "root",
                version: 1,
            },
        }

        expect(getTranslationValues(richTextFields, { content: emptyLexicalState })).toEqual([])
    })

    it("recognizes text inside Payload's Lexical root wrapper", () => {
        const richTextFields = [{ localized: true, name: "content", type: "richText" }] as never
        const lexicalState = {
            root: {
                children: [
                    {
                        children: [{ text: "Localized content", type: "text" }],
                        type: "paragraph",
                    },
                ],
                type: "root",
            },
        }

        expect(getTranslationValues(richTextFields, { content: lexicalState })).toEqual([
            {
                fieldType: "richText",
                path: "content",
                value: lexicalState,
            },
        ])
    })
})

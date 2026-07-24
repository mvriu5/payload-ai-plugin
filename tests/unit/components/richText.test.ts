import { describe, expect, it } from "vitest"

import { createGeneratedRichTextValue } from "../../../src/components/generate-field/richText.js"

describe("createGeneratedRichTextValue", () => {
    it("converts generated paragraphs into a Lexical editor state", () => {
        const value = createGeneratedRichTextValue("First paragraph.\nContinued.\n\nSecond paragraph.")

        expect(value.root.type).toBe("root")
        expect(value.root.children).toHaveLength(2)
        expect(value.root.children[0].children[0]).toMatchObject({
            text: "First paragraph. Continued.",
            type: "text",
        })
        expect(value.root.children[1].children[0].text).toBe("Second paragraph.")
    })
})

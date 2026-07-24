import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createGenerateFieldHandler } from "../../src/handlers/generateFieldHandler.js"
import type { TextGenerationPageContext } from "../../src/payload/textFieldGeneration.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"

const generateText = vi.hoisted(() => vi.fn())
const getModel = vi.hoisted(() => vi.fn())
const originalOpenAIKey = process.env.OPENAI_API_KEY

vi.mock("ai", async () => {
    const actual = await vi.importActual<typeof import("ai")>("ai")
    return {
        ...actual,
        generateText,
    }
})

vi.mock("../../src/ai/providerRuntime.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/ai/providerRuntime.js")>("../../src/ai/providerRuntime.js")
    return {
        ...actual,
        getModel,
    }
})

const pageContext: TextGenerationPageContext = {
    fields: [
        {
            description: "Concise article title",
            fieldType: "text",
            hasMany: false,
            key: "posts.title",
            label: "Title",
            maxLength: 40,
            name: "title",
        },
    ],
    label: "Post",
    slug: "posts",
    type: "collection",
}

describe("generateFieldHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.OPENAI_API_KEY = "test-key"
        getModel.mockResolvedValue({ model: "test" })
        generateText.mockResolvedValue({
            text: "A useful generated title",
            usage: {
                inputTokens: 10,
                outputTokens: 5,
                totalTokens: 15,
            },
        })
    })

    afterEach(() => {
        process.env.OPENAI_API_KEY = originalOpenAIKey
    })

    it("generates a value from the cached page schema and current form context", async () => {
        const handler = createGenerateFieldHandler({
            pageContexts: new Map([["collection:posts", pageContext]]),
        })
        const response = await handler(
            createMockRequest({
                body: {
                    context: {
                        category: "Science",
                        title: "",
                    },
                    fieldKey: "posts.title",
                    locale: "en",
                    scope: {
                        slug: "posts",
                        type: "collection",
                    },
                },
            })
        )

        expect(response.status).toBe(200)
        await expect(readJSON(response)).resolves.toEqual({
            value: "A useful generated title",
        })
        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining("Current unsaved page data"),
            })
        )
    })

    it("rejects fields that are not in the cached page schema", async () => {
        const handler = createGenerateFieldHandler({
            pageContexts: new Map([["collection:posts", pageContext]]),
        })
        const response = await handler(
            createMockRequest({
                body: {
                    fieldKey: "posts.secret",
                    scope: {
                        slug: "posts",
                        type: "collection",
                    },
                },
            })
        )

        expect(response.status).toBe(400)
        expect(generateText).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toEqual({
            error: "This field is not available for AI generation.",
        })
    })

    it("returns parsed data for JSON fields", async () => {
        generateText.mockResolvedValue({
            text: '```json\n{"theme":"dark","items":[1,2]}\n```',
            usage: {},
        })
        const jsonContext: TextGenerationPageContext = {
            ...pageContext,
            fields: [
                {
                    fieldType: "json",
                    hasMany: false,
                    key: "posts.metadata",
                    label: "Metadata",
                    name: "metadata",
                },
            ],
        }
        const handler = createGenerateFieldHandler({
            pageContexts: new Map([["collection:posts", jsonContext]]),
        })
        const response = await handler(
            createMockRequest({
                body: {
                    fieldKey: "posts.metadata",
                    scope: {
                        slug: "posts",
                        type: "collection",
                    },
                },
            })
        )

        expect(response.status).toBe(200)
        await expect(readJSON(response)).resolves.toEqual({
            value: {
                items: [1, 2],
                theme: "dark",
            },
        })
    })
})

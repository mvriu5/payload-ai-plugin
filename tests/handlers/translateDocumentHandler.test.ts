import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createTranslateDocumentHandler } from "../../src/handlers/translateDocumentHandler.js"
import type { TranslationPageContext } from "../../src/payload/documentTranslation.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"

const generateText = vi.hoisted(() => vi.fn())
const getModel = vi.hoisted(() => vi.fn())
const originalOpenAIKey = process.env.OPENAI_API_KEY

vi.mock("ai", async () => ({
    ...(await vi.importActual<typeof import("ai")>("ai")),
    generateText,
}))

vi.mock("../../src/ai/providerRuntime.js", async () => ({
    ...(await vi.importActual<typeof import("../../src/ai/providerRuntime.js")>("../../src/ai/providerRuntime.js")),
    getModel,
}))

const pageContext: TranslationPageContext = {
    fields: [
        {
            localized: true,
            name: "title",
            type: "text",
        },
        {
            name: "slug",
            type: "text",
        },
        {
            localized: true,
            name: "excerpt",
            type: "textarea",
        },
    ],
    label: "Post",
    slug: "posts",
    type: "collection",
}

describe("translateDocumentHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.OPENAI_API_KEY = "test-key"
        getModel.mockResolvedValue({ model: "test" })
        generateText.mockResolvedValue({
            text: '{"translations":{"0":"Hallo Welt"}}',
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

    it("offers translation only when the target locale is empty", async () => {
        const findByID = vi
            .fn()
            .mockResolvedValueOnce({ excerpt: "Source excerpt", title: "Hello world" })
            .mockResolvedValueOnce({ excerpt: null, title: "Hallo Welt" })
        const handler = createTranslateDocumentHandler({
            pageContexts: new Map([["collection:posts", pageContext]]),
        })
        const response = await handler(
            createMockRequest({
                body: {
                    action: "status",
                    id: "post-1",
                    locale: "de",
                    scope: { slug: "posts", type: "collection" },
                },
                findByID,
                localization: {
                    defaultLocale: "en",
                    locales: [{ code: "en" }, { code: "de" }],
                },
            })
        )

        expect(response.status).toBe(200)
        await expect(readJSON(response)).resolves.toEqual({ available: true })
        expect(findByID).toHaveBeenNthCalledWith(
            1,
            expect.objectContaining({
                fallbackLocale: false,
                locale: "en",
                overrideAccess: false,
            })
        )
        expect(findByID).toHaveBeenNthCalledWith(2, expect.objectContaining({ locale: "de" }))
        expect(generateText).not.toHaveBeenCalled()
    })

    it("returns translated values without saving the document", async () => {
        const findByID = vi.fn().mockResolvedValueOnce({ title: "Hello world" }).mockResolvedValueOnce({ title: null })
        const handler = createTranslateDocumentHandler({
            pageContexts: new Map([["collection:posts", pageContext]]),
        })
        const request = createMockRequest({
            body: {
                action: "translate",
                id: "post-1",
                locale: "de",
                scope: { slug: "posts", type: "collection" },
            },
            findByID,
            localization: {
                defaultLocale: "en",
                locales: [{ code: "en" }, { code: "de" }],
            },
        })
        const response = await handler(request)

        expect(response.status).toBe(200)
        await expect(readJSON(response)).resolves.toEqual({
            available: true,
            values: [
                {
                    fieldType: "text",
                    path: "title",
                    value: "Hallo Welt",
                },
            ],
        })
        expect(generateText).toHaveBeenCalledOnce()
        expect(request.payload.update).not.toHaveBeenCalled()
        expect(request.payload.updateGlobal).not.toHaveBeenCalled()
    })

    it("offers translation when only some target fields already have content", async () => {
        const findByID = vi
            .fn()
            .mockResolvedValueOnce({ excerpt: "Source excerpt", title: "Hello world" })
            .mockResolvedValueOnce({ excerpt: null, title: "Hallo Welt" })
        const handler = createTranslateDocumentHandler({
            pageContexts: new Map([["collection:posts", pageContext]]),
        })
        const response = await handler(
            createMockRequest({
                body: {
                    action: "status",
                    id: "post-1",
                    locale: "de",
                    scope: { slug: "posts", type: "collection" },
                },
                findByID,
                localization: {
                    defaultLocale: "en",
                    locales: [{ code: "en" }, { code: "de" }],
                },
            })
        )

        await expect(readJSON(response)).resolves.toEqual({ available: true })
    })

    it("hides translation when every source field has target content", async () => {
        const findByID = vi
            .fn()
            .mockResolvedValueOnce({ excerpt: "Source excerpt", title: "Hello world" })
            .mockResolvedValueOnce({ excerpt: "Deutscher Auszug", title: "Hallo Welt" })
        const handler = createTranslateDocumentHandler({
            pageContexts: new Map([["collection:posts", pageContext]]),
        })
        const response = await handler(
            createMockRequest({
                body: {
                    action: "status",
                    id: "post-1",
                    locale: "de",
                    scope: { slug: "posts", type: "collection" },
                },
                findByID,
                localization: {
                    defaultLocale: "en",
                    locales: [{ code: "en" }, { code: "de" }],
                },
            })
        )

        await expect(readJSON(response)).resolves.toEqual({ available: false })
    })

    it("translates only localized fields that are empty in the target locale", async () => {
        generateText.mockResolvedValue({
            text: '{"translations":{"0":"Deutscher Auszug"}}',
            usage: {},
        })
        const findByID = vi
            .fn()
            .mockResolvedValueOnce({ excerpt: "Source excerpt", title: "Hello world" })
            .mockResolvedValueOnce({ excerpt: "", title: "Existing German title" })
        const handler = createTranslateDocumentHandler({
            pageContexts: new Map([["collection:posts", pageContext]]),
        })
        const response = await handler(
            createMockRequest({
                body: {
                    action: "translate",
                    id: "post-1",
                    locale: "de",
                    scope: { slug: "posts", type: "collection" },
                },
                findByID,
                localization: {
                    defaultLocale: "en",
                    locales: [{ code: "en" }, { code: "de" }],
                },
            })
        )

        expect(response.status).toBe(200)
        await expect(readJSON(response)).resolves.toEqual({
            available: true,
            values: [
                {
                    fieldType: "textarea",
                    path: "excerpt",
                    value: "Deutscher Auszug",
                },
            ],
        })
        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.not.stringContaining("Existing German title"),
            })
        )
    })
})

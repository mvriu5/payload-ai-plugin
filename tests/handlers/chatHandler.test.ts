import { beforeEach, describe, expect, it, vi } from "vitest"

import { createChatHandler } from "../../src/handlers/chatHandler.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"
import { mediaCollection, postsCollection } from "../fixtures/payloadConfig.js"

const streamText = vi.hoisted(() => vi.fn())
const getModel = vi.hoisted(() => vi.fn())

vi.mock("ai", async () => {
    const actual = await vi.importActual<typeof import("ai")>("ai")

    return {
        ...actual,
        streamText,
    }
})

vi.mock("../../src/ai/providerRuntime.js", async () => {
    const actual = await vi.importActual<typeof import("../../src/ai/providerRuntime.js")>("../../src/ai/providerRuntime.js")

    return {
        ...actual,
        getModel,
    }
})

const readText = async (response: Response) => response.text()

describe("chatHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.OPENAI_API_KEY = "test-openai-key"
        getModel.mockResolvedValue({ model: "mock" })
        streamText.mockReturnValue({
            fullStream: (async function* () {
                yield {
                    text: "Prepared update",
                    type: "text-delta",
                }
                yield {
                    totalUsage: {
                        inputTokens: 10,
                        outputTokens: 5,
                        totalTokens: 15,
                    },
                    type: "finish",
                }
            })(),
        })
    })

    it("rejects anonymous users", async () => {
        const handler = createChatHandler()
        const response = await handler(createMockRequest({ user: null }))

        expect(response.status).toBe(401)
        await expect(readJSON(response)).resolves.toEqual({ error: "Unauthorized" })
    })

    it("rejects empty prompts", async () => {
        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    prompt: "   ",
                },
            })
        )

        expect(response.status).toBe(400)
        await expect(readJSON(response)).resolves.toEqual({ error: "Prompt is required" })
    })

    it("rejects unsupported providers before calling the model", async () => {
        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    prompt: "Hello",
                },
                user: {
                    aiProvider: "unknown",
                    id: "user-1",
                },
            })
        )

        expect(response.status).toBe(400)
        expect(getModel).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toEqual({ error: "Unsupported AI provider: unknown" })
    })

    it("returns provider key errors without creating a model", async () => {
        delete process.env.OPENAI_API_KEY

        const handler = createChatHandler({ allowUserApiKeys: false })
        const response = await handler(
            createMockRequest({
                body: {
                    prompt: "Hello",
                },
                user: {
                    aiProvider: "openai",
                    id: "user-1",
                },
            })
        )

        expect(response.status).toBe(400)
        expect(getModel).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toEqual({ error: "Configure a openai API key in the server environment first." })
    })

    it("streams text, proposals and usage without calling a real AI provider", async () => {
        const handler = createChatHandler()
        const req = createMockRequest({
            body: {
                model: "gpt-test",
                prompt: "What can you do?",
            },
            collections: [postsCollection],
            user: {
                aiProvider: "openai",
                id: "user-1",
            },
        })
        const response = await handler(req)
        const text = await readText(response)

        expect(response.headers.get("Content-Type")).toContain("text/event-stream")
        expect(getModel).toHaveBeenCalledWith({
            apiKey: "test-openai-key",
            model: "gpt-test",
            provider: "openai",
        })
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                maxOutputTokens: 700,
                prompt: "What can you do?",
            })
        )
        expect(text).toContain('event: text\ndata: {"delta":"Prepared update"}')
        expect(text).toContain('event: proposals\ndata: {"proposals":[],"usage":{"inputTokens":10,"outputTokens":5,"totalTokens":15}}')
        expect(text).toContain("event: done")
    })

    it("adds uploaded media attachments and media schema to prompt context", async () => {
        const findByID = vi.fn().mockResolvedValue({
            filename: "hero.png",
            id: "media-1",
            mimeType: "image/png",
            url: "/media/hero.png",
        })
        const handler = createChatHandler()
        const req = createMockRequest({
            body: {
                attachments: [
                    {
                        collection: "media",
                        filename: "hero.png",
                        filesize: 512,
                        id: "media-1",
                        mimeType: "image/png",
                        type: "media",
                        url: "/media/hero.png",
                    },
                ],
                model: "gpt-test",
                prompt: "Use the uploaded image and write suitable media fields",
            },
            collections: [postsCollection, mediaCollection],
            findByID,
            user: {
                aiProvider: "openai",
                id: "user-1",
            },
        })

        await handler(req)

        expect(findByID).toHaveBeenCalledWith({
            collection: "media",
            depth: 1,
            id: "media-1",
            overrideAccess: false,
            req,
        })
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining("mediaAttachment"),
            })
        )
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining('"name":"alt"'),
            })
        )
    })
})

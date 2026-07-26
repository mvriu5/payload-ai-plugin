import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createChatHandler } from "../../src/handlers/chatHandler.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"
import { mediaCollection, postsCollection, siteSettingsGlobal } from "../fixtures/payloadConfig.js"

const streamText = vi.hoisted(() => vi.fn())
const getModel = vi.hoisted(() => vi.fn())
const originalPayloadSecret = process.env.PAYLOAD_SECRET

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

type ToolInvocationArgs = {
    tools: {
        proposeCreateDoc: {
            execute: (input: unknown) => Promise<unknown>
        }
    }
}

type ScopedToolInvocationArgs = {
    prompt?: string
    providerOptions?: Record<string, unknown>
    system?: Array<{
        content: string
        providerOptions?: Record<string, unknown>
        role: string
    }>
    toolChoice?: {
        toolName: string
        type: string
    }
    tools: Record<
        string,
        {
            execute?: (input: Record<string, unknown>) => Promise<unknown>
            inputSchema?: {
                safeParse: (input: unknown) => {
                    success: boolean
                }
            }
        }
    >
}

describe("chatHandler", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        process.env.OPENAI_API_KEY = "test-openai-key"
        process.env.PAYLOAD_SECRET = "test-secret"
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

    afterEach(() => {
        process.env.PAYLOAD_SECRET = originalPayloadSecret
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

    it("limits document-field chats to the current document", async () => {
        const findByID = vi.fn().mockResolvedValue({
            id: "post-1",
            title: "Current post",
        })
        let capturedTools: ScopedToolInvocationArgs["tools"] = {}
        streamText.mockImplementationOnce((args: ScopedToolInvocationArgs) => {
            capturedTools = args.tools

            return {
                fullStream: (async function* () {
                    yield { totalUsage: { totalTokens: 1 }, type: "finish" }
                })(),
            }
        })

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    documentScope: {
                        collection: "posts",
                        id: "post-1",
                        type: "collection",
                    },
                    prompt: "Update the title",
                },
                collections: [postsCollection],
                findByID,
            })
        )
        await readText(response)

        expect(Object.keys(capturedTools).sort()).toEqual(["getDoc", "listCollections", "proposeUpdateDoc"])
        expect(findByID).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "posts",
                depth: 0,
                id: "post-1",
                overrideAccess: false,
                select: {
                    slug: true,
                    title: true,
                    updatedAt: true,
                },
            })
        )
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                system: expect.arrayContaining([
                    expect.objectContaining({
                        content: expect.stringContaining('"name":"title"'),
                    }),
                ]),
            })
        )
        await expect(
            capturedTools.proposeUpdateDoc?.execute?.({
                collection: "posts",
                data: { title: "Other post" },
                id: "post-2",
                label: "Update other post",
            })
        ).resolves.toEqual(
            expect.objectContaining({
                error: "Only the current document can be updated in this context.",
                errorCode: "NON_RETRYABLE_TOOL_ERROR",
                retryable: false,
            })
        )
    })

    it("uses the focused collection schema for proposal tool inputs", async () => {
        let capturedTools: ScopedToolInvocationArgs["tools"] = {}
        streamText.mockImplementationOnce((args: ScopedToolInvocationArgs) => {
            capturedTools = args.tools

            return {
                fullStream: (async function* () {
                    yield { totalUsage: { totalTokens: 1 }, type: "finish" }
                })(),
            }
        })

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    mentions: [{ slug: "posts", type: "collection" }],
                    prompt: "Create a post",
                },
                collections: [postsCollection],
            })
        )
        await readText(response)

        const schema = capturedTools.proposeCreateDoc?.inputSchema

        expect(
            schema?.safeParse({
                collection: "posts",
                data: { title: "Valid post" },
                label: "Create post",
            }).success
        ).toBe(true)
        expect(
            schema?.safeParse({
                collection: "posts",
                data: { missing: "field" },
                label: "Create post",
            }).success
        ).toBe(false)
        expect(
            schema?.safeParse({
                collection: "media",
                data: { title: "Wrong collection" },
                label: "Create post",
            }).success
        ).toBe(false)
    })

    it("loads only explicitly requested document fields and relationships", async () => {
        const richPostsCollection = {
            ...postsCollection,
            fields: [
                ...postsCollection.fields,
                { name: "content", type: "richText" },
                { name: "author", relationTo: "users", type: "relationship" },
            ],
        }
        const findByID = vi.fn().mockResolvedValue({
            author: { id: "user-1", name: "Author" },
            content: "Content",
            id: "post-1",
        })
        let capturedTools: ScopedToolInvocationArgs["tools"] = {}
        streamText.mockImplementationOnce((args: ScopedToolInvocationArgs) => {
            capturedTools = args.tools
            return {
                fullStream: (async function* () {
                    yield { totalUsage: { totalTokens: 1 }, type: "finish" }
                })(),
            }
        })

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    mentions: [{ slug: "posts", type: "collection" }],
                    prompt: "Find the post content",
                },
                collections: [richPostsCollection],
                findByID,
            })
        )
        await readText(response)

        await capturedTools.getDoc?.execute?.({
            collection: "posts",
            fields: ["content", "author"],
            id: "post-1",
        })

        expect(findByID).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "posts",
                depth: 1,
                id: "post-1",
                select: {
                    author: true,
                    content: true,
                },
            })
        )
        expect(
            capturedTools.getDoc?.inputSchema?.safeParse({
                collection: "posts",
                fields: ["apiKey"],
                id: "post-1",
            }).success
        ).toBe(false)
    })

    it("keeps explicitly mentioned documents complete at depth two", async () => {
        const findByID = vi.fn().mockResolvedValue({
            content: "Complete content",
            id: "post-1",
            title: "Mentioned post",
        })
        let capturedTools: ScopedToolInvocationArgs["tools"] = {}
        streamText.mockImplementationOnce((args: ScopedToolInvocationArgs) => {
            capturedTools = args.tools
            return {
                fullStream: (async function* () {
                    yield { totalUsage: { totalTokens: 1 }, type: "finish" }
                })(),
            }
        })

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    mentions: [
                        {
                            collection: "posts",
                            id: "post-1",
                            type: "doc",
                        },
                    ],
                    prompt: "Show the mentioned post",
                },
                collections: [postsCollection],
                findByID,
            })
        )
        await readText(response)
        findByID.mockClear()

        await capturedTools.getDoc?.execute?.({
            collection: "posts",
            fields: ["title"],
            id: "post-1",
        })

        expect(findByID).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "posts",
                depth: 2,
                id: "post-1",
            })
        )
        expect(findByID.mock.calls[0]?.[0]).not.toHaveProperty("select")
    })

    it("returns compact search results with default identity fields", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [{ id: "post-1", slug: "post", title: "Post" }],
            hasNextPage: true,
            page: 1,
            totalDocs: 50,
            totalPages: 10,
        })
        let capturedTools: ScopedToolInvocationArgs["tools"] = {}
        streamText.mockImplementationOnce((args: ScopedToolInvocationArgs) => {
            capturedTools = args.tools
            return {
                fullStream: (async function* () {
                    yield { totalUsage: { totalTokens: 1 }, type: "finish" }
                })(),
            }
        })

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    mentions: [{ slug: "posts", type: "collection" }],
                    prompt: "Search posts",
                },
                collections: [postsCollection],
                find,
            })
        )
        await readText(response)

        const result = await capturedTools.searchDocs?.execute?.({
            collection: "posts",
            limit: 5,
            query: "Post",
        })

        expect(find).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "posts",
                depth: 0,
                select: {
                    slug: true,
                    title: true,
                },
            })
        )
        expect(result).toEqual({
            docs: [{ id: "post-1", slug: "post", title: "Post" }],
            hasNextPage: true,
        })
    })

    it("allows one structured repair and accepts the corrected proposal", async () => {
        let invalidResult: unknown
        let repairedResult: unknown
        streamText.mockImplementationOnce((args: ToolInvocationArgs) => ({
            fullStream: (async function* () {
                invalidResult = await args.tools.proposeCreateDoc.execute({
                    collection: "posts",
                    data: {
                        unknown: "value",
                    },
                    label: "Create repaired post",
                })
                repairedResult = await args.tools.proposeCreateDoc.execute({
                    collection: "posts",
                    data: {
                        title: "Repaired post",
                    },
                    label: "Create repaired post",
                })
                yield {
                    totalUsage: {
                        totalTokens: 1,
                    },
                    type: "finish",
                }
            })(),
        }))

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    mentions: [{ slug: "posts", type: "collection" }],
                    prompt: "Create a repaired post",
                },
                collections: [postsCollection],
            })
        )
        await readText(response)

        expect(invalidResult).toMatchObject({
            errorCode: "INVALID_PROPOSAL_DATA",
            repair: {
                attempt: 1,
                issues: [
                    {
                        code: "unknown_field",
                        path: "unknown",
                    },
                ],
                maxAttempts: 1,
            },
            retryable: true,
        })
        expect(repairedResult).toMatchObject({
            action: "create",
            collection: "posts",
            data: {
                title: "Repaired post",
            },
        })
    })

    it("blocks proposal calls after the single repair attempt is exhausted", async () => {
        const results: unknown[] = []
        streamText.mockImplementationOnce((args: ToolInvocationArgs) => ({
            fullStream: (async function* () {
                results.push(
                    await args.tools.proposeCreateDoc.execute({
                        collection: "posts",
                        data: { firstUnknown: true },
                        label: "Create exhausted post",
                    })
                )
                results.push(
                    await args.tools.proposeCreateDoc.execute({
                        collection: "posts",
                        data: { secondUnknown: true },
                        label: "Create exhausted post",
                    })
                )
                results.push(
                    await args.tools.proposeCreateDoc.execute({
                        collection: "posts",
                        data: { title: "Too late" },
                        label: "Create exhausted post",
                    })
                )
                yield {
                    totalUsage: {
                        totalTokens: 1,
                    },
                    type: "finish",
                }
            })(),
        }))

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    mentions: [{ slug: "posts", type: "collection" }],
                    prompt: "Create a post",
                },
                collections: [postsCollection],
            })
        )
        const text = await readText(response)

        expect(results[0]).toMatchObject({
            errorCode: "INVALID_PROPOSAL_DATA",
            retryable: true,
        })
        expect(results[1]).toMatchObject({
            errorCode: "REPAIR_EXHAUSTED",
            retryable: false,
        })
        expect(results[2]).toMatchObject({
            errorCode: "REPAIR_EXHAUSTED",
            retryable: false,
        })
        expect(text).toContain('"proposals":[]')
    })

    it("uses depth two only for an explicitly mentioned current document without duplicating its data", async () => {
        const findByID = vi.fn().mockResolvedValue({
            id: "post-1",
            title: "Mentioned post",
        })
        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    documentScope: {
                        collection: "posts",
                        id: "post-1",
                        type: "collection",
                    },
                    mentions: [
                        {
                            collection: "posts",
                            id: "post-1",
                            label: "Mentioned post",
                            slug: "mentioned-post",
                            type: "doc",
                        },
                    ],
                    prompt: "Überarbeite den erwähnten Beitrag",
                },
                collections: [postsCollection],
                findByID,
            })
        )
        await readText(response)

        expect(findByID).toHaveBeenCalledTimes(1)
        expect(findByID).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "posts",
                depth: 2,
                id: "post-1",
                overrideAccess: false,
            })
        )
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining('"type":"currentDocumentScope"'),
            })
        )
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                system: expect.arrayContaining([
                    expect.objectContaining({
                        content: expect.stringContaining('"name":"title"'),
                    }),
                ]),
            })
        )
    })

    it.each([
        {
            body: {
                mentions: [{ label: "Posts", slug: "posts", type: "collection" }],
                prompt: "Erstelle einen neuen Beitrag",
            },
            expectedToolChoice: "proposeCreateDoc",
            expectedTools: ["getDoc", "listCollections", "proposeCreateDoc", "searchDocs"],
        },
        {
            body: {
                documentScope: {
                    collection: "posts",
                    id: "post-1",
                    type: "collection",
                },
                prompt: "Ergänze einen weiteren Absatz",
            },
            expectedToolChoice: "proposeUpdateDoc",
            expectedTools: ["getDoc", "listCollections", "proposeUpdateDoc"],
        },
        {
            body: {
                documentScope: {
                    collection: "posts",
                    id: "post-1",
                    type: "collection",
                },
                prompt: "Lösche diesen Beitrag",
            },
            expectedToolChoice: "proposeDeleteDoc",
            expectedTools: ["getDoc", "proposeDeleteDoc"],
        },
        {
            body: {
                prompt: "Zeige mir andere passende Beiträge",
            },
            expectedToolChoice: undefined,
            expectedTools: ["getDoc", "getGlobal", "listCollections", "listGlobals", "searchDocs"],
        },
        {
            body: {
                prompt: "Was kannst du für mich tun?",
            },
            expectedToolChoice: undefined,
            expectedTools: ["getDoc", "getGlobal", "listCollections", "listGlobals", "searchDocs"],
        },
    ])("routes '$body.prompt' to a focused tool set", async ({ body, expectedToolChoice, expectedTools }) => {
        const findByID = vi.fn().mockResolvedValue({
            id: "post-1",
            title: "Current post",
        })
        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body,
                collections: [postsCollection],
                findByID,
            })
        )
        await readText(response)

        const invocation = streamText.mock.calls.at(-1)?.[0] as ScopedToolInvocationArgs

        expect(Object.keys(invocation.tools).sort()).toEqual(expectedTools)
        expect(invocation.toolChoice?.toolName).toBe(expectedToolChoice)
    })

    it("routes German global updates to global tools", async () => {
        const findGlobal = vi.fn().mockResolvedValue({
            siteName: "Current site",
        })
        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    documentScope: {
                        slug: "site-settings",
                        type: "global",
                    },
                    prompt: "Passe die Seiteneinstellungen an",
                },
                collections: [postsCollection],
                findGlobal,
                globals: [siteSettingsGlobal],
            })
        )
        await readText(response)

        const invocation = streamText.mock.calls.at(-1)?.[0] as ScopedToolInvocationArgs

        expect(Object.keys(invocation.tools).sort()).toEqual(["getGlobal", "listGlobals", "proposeUpdateGlobal"])
        expect(invocation.toolChoice?.toolName).toBe("proposeUpdateGlobal")
        expect(findGlobal).toHaveBeenCalledWith(
            expect.objectContaining({
                depth: 0,
                select: {
                    siteName: true,
                    updatedAt: true,
                },
                slug: "site-settings",
            })
        )
        expect(invocation.system?.map((message) => message.content).join("\n")).toContain('"name":"siteName"')
    })

    it("blocks requests when the user token limit is reached", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [
                {
                    recordedAt: new Date().toISOString(),
                    totalTokens: 1000,
                },
            ],
            hasNextPage: false,
        })
        const handler = createChatHandler({
            maxTokenUsage: {
                perDay: 1000,
                type: "user",
            },
        })
        const response = await handler(
            createMockRequest({
                body: {
                    prompt: "Hello",
                },
                find,
                user: {
                    aiProvider: "openai",
                    id: "user-1",
                },
            })
        )

        expect(response.status).toBe(429)
        expect(getModel).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toEqual({
            error: "Daily AI token limit reached for this user.",
            limit: 1000,
            period: "day",
            used: 1000,
        })
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

    it("records completed model usage when token limits are configured", async () => {
        const create = vi.fn().mockResolvedValue({ id: "usage-1" })
        const find = vi.fn().mockResolvedValue({
            docs: [],
            hasNextPage: false,
        })
        const handler = createChatHandler({
            maxTokenUsage: {
                perWeek: 10000,
                type: "site",
            },
        })
        const response = await handler(
            createMockRequest({
                body: {
                    model: "gpt-test",
                    prompt: "What can you do?",
                },
                collections: [postsCollection],
                create,
                find,
                user: {
                    aiProvider: "openai",
                    id: "user-1",
                },
            })
        )

        const text = await readText(response)

        expect(response.status, text).toBe(200)
        expect(text).toContain("event: proposals")
        expect(create).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "payload-ai-usage",
                data: expect.objectContaining({
                    inputTokens: 10,
                    model: "gpt-test",
                    outputTokens: 5,
                    provider: "openai",
                    totalTokens: 15,
                    userID: "user-1",
                }),
                overrideAccess: true,
            })
        )
    })

    it("uses managed provider credentials and custom base URLs", async () => {
        const handler = createChatHandler({
            providers: [
                {
                    apiKey: "managed-key",
                    baseURL: "http://localhost:11434/v1",
                    defaultModel: "llama3.3",
                    id: "ollama",
                    label: "Ollama",
                    models: [{ label: "Llama 3.3", value: "llama3.3" }],
                    provider: "openai",
                },
            ],
        })
        const response = await handler(
            createMockRequest({
                body: {
                    model: "llama3.3",
                    prompt: "What can you do?",
                    provider: "ollama",
                },
                collections: [postsCollection],
                user: {
                    aiApiKey: "ignored-user-key",
                    aiProvider: "unknown",
                    id: "user-1",
                },
            })
        )

        expect(response.status).toBe(200)
        expect(getModel).toHaveBeenCalledWith({
            apiKey: "managed-key",
            baseURL: "http://localhost:11434/v1",
            model: "llama3.3",
            provider: "openai",
        })
        expect(streamText.mock.calls.at(-1)?.[0]).not.toHaveProperty("providerOptions")
    })

    it("rejects models outside the managed provider configuration", async () => {
        const handler = createChatHandler({
            providers: [
                {
                    apiKey: "managed-key",
                    defaultModel: "allowed-model",
                    id: "managed",
                    label: "Managed",
                    models: [{ label: "Allowed", value: "allowed-model" }],
                    provider: "openai",
                },
            ],
        })
        const response = await handler(
            createMockRequest({
                body: {
                    model: "unapproved-model",
                    prompt: "Hello",
                    provider: "managed",
                },
            })
        )

        expect(response.status).toBe(400)
        expect(getModel).not.toHaveBeenCalled()
        await expect(readJSON(response)).resolves.toEqual({
            error: 'Unsupported model "unapproved-model" for AI provider "managed".',
        })
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
            depth: 0,
            id: "media-1",
            overrideAccess: false,
            req,
            select: {
                alt: true,
                filename: true,
                filesize: true,
                mimeType: true,
                updatedAt: true,
                url: true,
            },
        })
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                prompt: expect.stringContaining("mediaAttachment"),
            })
        )
        expect(streamText).toHaveBeenCalledWith(
            expect.objectContaining({
                system: expect.arrayContaining([
                    expect.objectContaining({
                        content: expect.stringContaining('"name":"alt"'),
                    }),
                ]),
            })
        )
    })

    it("rejects upload field references outside the uploaded attachments", async () => {
        const uploadPostCollection = {
            fields: [
                {
                    name: "title",
                    required: true,
                    type: "text",
                },
                {
                    name: "heroImage",
                    relationTo: "media",
                    type: "upload",
                },
            ],
            slug: "posts",
        }
        const findByID = vi.fn().mockResolvedValue({
            filename: "hero.png",
            id: 10,
            mimeType: "image/png",
            url: "/media/hero.png",
        })

        streamText.mockImplementationOnce((args: ToolInvocationArgs) => ({
            fullStream: (async function* () {
                await args.tools.proposeCreateDoc.execute({
                    collection: "posts",
                    data: {
                        heroImage: "999",
                        title: "People",
                    },
                    label: "Create People post",
                })
                yield {
                    totalUsage: {
                        totalTokens: 1,
                    },
                    type: "finish",
                }
            })(),
        }))

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    attachments: [
                        {
                            collection: "media",
                            filename: "hero.png",
                            filesize: 512,
                            id: "10",
                            mimeType: "image/png",
                            type: "media",
                            url: "/media/hero.png",
                        },
                    ],
                    model: "gpt-test",
                    prompt: "Create a post and use the uploaded image as heroImage",
                },
                collections: [uploadPostCollection, mediaCollection],
                findByID,
                user: {
                    aiProvider: "openai",
                    id: "user-1",
                },
            })
        )
        const text = await readText(response)

        expect(text).toContain("event: proposals")
        expect(text).toContain('"proposals":[]')
        expect(text).toContain("uses upload references that are not in the uploaded attachments")
    })

    it("accepts uploaded attachment IDs in upload fields", async () => {
        const uploadPostCollection = {
            fields: [
                {
                    name: "title",
                    required: true,
                    type: "text",
                },
                {
                    name: "heroImage",
                    relationTo: "media",
                    type: "upload",
                },
            ],
            slug: "posts",
        }
        const findByID = vi.fn().mockResolvedValue({
            filename: "hero.png",
            id: 10,
            mimeType: "image/png",
            url: "/media/hero.png",
        })

        streamText.mockImplementationOnce((args: ToolInvocationArgs) => ({
            fullStream: (async function* () {
                await args.tools.proposeCreateDoc.execute({
                    collection: "posts",
                    data: {
                        heroImage: "10",
                        title: "People",
                    },
                    label: "Create People post",
                })
                yield {
                    totalUsage: {
                        totalTokens: 1,
                    },
                    type: "finish",
                }
            })(),
        }))

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    attachments: [
                        {
                            collection: "media",
                            filename: "hero.png",
                            filesize: 512,
                            id: "10",
                            mimeType: "image/png",
                            type: "media",
                            url: "/media/hero.png",
                        },
                    ],
                    model: "gpt-test",
                    prompt: "Create a post and use the uploaded image as heroImage",
                },
                collections: [uploadPostCollection, mediaCollection],
                findByID,
                user: {
                    aiProvider: "openai",
                    id: "user-1",
                },
            })
        )
        const text = await readText(response)

        expect(text).toContain("event: proposals")
        expect(text).toContain('"label":"Create People post"')
        expect(text).toContain('"heroImage":10')
        expect(text).not.toContain("uses upload references that are not in the uploaded attachments")
    })

    it("checks uploaded attachment IDs inside block upload fields", async () => {
        const blockPostCollection = {
            fields: [
                {
                    name: "title",
                    required: true,
                    type: "text",
                },
                {
                    blocks: [
                        {
                            fields: [
                                {
                                    name: "copy",
                                    type: "text",
                                },
                                {
                                    name: "image",
                                    relationTo: "media",
                                    type: "upload",
                                },
                            ],
                            slug: "hero",
                        },
                    ],
                    name: "layout",
                    type: "blocks",
                },
            ],
            slug: "posts",
        }
        const findByID = vi.fn().mockResolvedValue({
            filename: "hero.png",
            id: 10,
            mimeType: "image/png",
            url: "/media/hero.png",
        })

        streamText.mockImplementationOnce((args: ToolInvocationArgs) => ({
            fullStream: (async function* () {
                await args.tools.proposeCreateDoc.execute({
                    collection: "posts",
                    data: {
                        layout: [
                            {
                                blockType: "hero",
                                copy: "People stories",
                                image: "999",
                            },
                        ],
                        title: "People",
                    },
                    label: "Create People post",
                })
                yield {
                    totalUsage: {
                        totalTokens: 1,
                    },
                    type: "finish",
                }
            })(),
        }))

        const handler = createChatHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    attachments: [
                        {
                            collection: "media",
                            filename: "hero.png",
                            filesize: 512,
                            id: "10",
                            mimeType: "image/png",
                            type: "media",
                            url: "/media/hero.png",
                        },
                    ],
                    model: "gpt-test",
                    prompt: "Create a hero block and use another image id",
                },
                collections: [blockPostCollection, mediaCollection],
                findByID,
                user: {
                    aiProvider: "openai",
                    id: "user-1",
                },
            })
        )
        const text = await readText(response)

        expect(text).toContain("event: proposals")
        expect(text).toContain('"proposals":[]')
        expect(text).toContain("uses upload references that are not in the uploaded attachments")
        expect(text).toContain("layout.0.image")
    })
})

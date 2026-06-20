import { describe, expect, it, vi } from "vitest"

import { createMentionSuggestionHandler } from "../../src/handlers/mentionSuggestionHandler.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"

const postsCollection = {
    admin: {
        useAsTitle: "title",
    },
    fields: [
        {
            localized: true,
            name: "title",
            type: "text",
        },
    ],
    slug: "posts",
}

describe("mentionSuggestionHandler", () => {
    it("rejects anonymous users", async () => {
        const handler = createMentionSuggestionHandler()
        const response = await handler(createMockRequest({ user: null }))

        expect(response.status).toBe(401)
        await expect(readJSON(response)).resolves.toEqual({ error: "Unauthorized" })
    })

    it("returns no suggestions without query or collection slug", async () => {
        const handler = createMentionSuggestionHandler()
        const response = await handler(createMockRequest({ body: {} }))

        await expect(readJSON(response)).resolves.toEqual({ suggestions: [] })
    })

    it("searches documents by their visible localized title label", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [
                {
                    id: 4,
                    title: "Jupiter",
                },
                {
                    id: 5,
                    title: "Saturn",
                },
            ],
        })
        const handler = createMentionSuggestionHandler()
        const response = await handler(
            createMockRequest({
                body: {
                    query: "j",
                },
                collections: [postsCollection],
                find,
                localization: {
                    localeCodes: ["en", "de"],
                },
            })
        )

        expect(find).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: "posts",
                depth: 0,
                limit: 100,
                locale: "en",
                overrideAccess: false,
            })
        )
        await expect(readJSON(response)).resolves.toEqual({
            suggestions: [
                {
                    collection: "posts",
                    id: "4",
                    label: "Jupiter",
                    slug: "posts:4",
                    type: "doc",
                },
            ],
        })
    })

    it("limits suggestions to readable collections and deduplicates locale results", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [
                {
                    id: "4",
                    title: "Jupiter",
                },
            ],
        })
        const handler = createMentionSuggestionHandler({
            collections: {
                posts: {
                    create: false,
                    delete: false,
                    read: true,
                    update: false,
                },
                users: {
                    create: false,
                    delete: false,
                    read: false,
                    update: false,
                },
            },
        })
        const response = await handler(
            createMockRequest({
                body: {
                    query: "j",
                },
                collections: [
                    postsCollection,
                    {
                        fields: [{ name: "email", type: "email" }],
                        slug: "users",
                    },
                ],
                find,
                localization: {
                    localeCodes: ["en", "de"],
                },
            })
        )

        expect(find).toHaveBeenCalledTimes(2)
        expect(find).toHaveBeenNthCalledWith(1, expect.objectContaining({ collection: "posts", locale: "en" }))
        expect(find).toHaveBeenNthCalledWith(2, expect.objectContaining({ collection: "posts", locale: "de" }))
        await expect(readJSON(response)).resolves.toEqual({
            suggestions: [
                {
                    collection: "posts",
                    id: "4",
                    label: "Jupiter",
                    slug: "posts:4",
                    type: "doc",
                },
            ],
        })
    })
})

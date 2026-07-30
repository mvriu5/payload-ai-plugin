import { describe, expect, it } from "vitest"

import { createCachedSystemMessages, createPromptCacheProviderOptions, splitPromptCacheContext } from "../../../src/features/promptCaching.js"

describe("promptCaching", () => {
    it("keeps schemas cacheable and document content dynamic", () => {
        const result = splitPromptCacheContext([
            {
                doc: { id: "global-1", siteName: "Current" },
                fields: [{ name: "siteName", type: "text" }],
                slug: "site-settings",
                type: "global",
            },
            {
                attachment: { collection: "media", id: "media-1" },
                doc: { alt: "Current", id: "media-1" },
                schema: {
                    fields: [{ name: "alt", type: "text" }],
                    slug: "media",
                    type: "collection",
                },
                type: "mediaAttachment",
            },
        ])

        expect(result.cacheable).toEqual([
            {
                fields: [{ name: "siteName", type: "text" }],
                slug: "site-settings",
                type: "global",
            },
            {
                fields: [{ name: "alt", type: "text" }],
                slug: "media",
                type: "collection",
            },
        ])
        expect(JSON.stringify(result.cacheable)).not.toContain("Current")
        expect(JSON.stringify(result.dynamic)).toContain("Current")
        expect(JSON.stringify(result.dynamic)).not.toContain('"schema"')
    })

    it("adds Anthropic cache breakpoints only to cacheable system messages", () => {
        const messages = createCachedSystemMessages({
            cacheableContext: [{ slug: "posts", type: "collection" }],
            cacheableInstructions: ["Stable collection instructions"],
            dynamicInstructions: ["Current request instructions"],
            enabled: true,
            provider: "claude",
            staticInstructions: ["Static instructions"],
        })

        expect(messages).toHaveLength(3)
        expect(messages[0].providerOptions).toEqual({
            anthropic: {
                cacheControl: {
                    type: "ephemeral",
                },
            },
        })
        expect(messages[1].providerOptions).toEqual(messages[0].providerOptions)
        expect(messages[2].providerOptions).toBeUndefined()
    })

    it("creates stable, scope-specific OpenAI cache keys", () => {
        const createOptions = (scope: string) =>
            createPromptCacheProviderOptions({
                cacheKeyParts: [scope],
                enabled: true,
                model: "gpt-4.1-mini",
                provider: "openai",
            })

        expect(createOptions("posts")).toEqual(createOptions("posts"))
        expect(createOptions("posts")).not.toEqual(createOptions("pages"))
        expect(JSON.stringify(createOptions("posts"))).not.toContain("posts")
    })

    it("supports OpenRouter Anthropic caching and disabling explicit hints", () => {
        expect(
            createPromptCacheProviderOptions({
                cacheKeyParts: [],
                enabled: true,
                model: "anthropic/claude-sonnet-4",
                provider: "openrouter",
            })
        ).toEqual({
            openrouter: {
                cache_control: {
                    type: "ephemeral",
                },
            },
        })
        expect(
            createPromptCacheProviderOptions({
                cacheKeyParts: [],
                enabled: false,
                model: "gpt-4.1-mini",
                provider: "openai",
            })
        ).toBeUndefined()
    })
})

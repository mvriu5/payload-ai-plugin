import { describe, expect, it } from "vitest"

import { payloadAiPlugin } from "../../../src/index.js"

const createBaseConfig = () => ({
    admin: {
        components: {},
        custom: {},
        user: "users",
    },
    collections: [
        {
            fields: [],
            slug: "users",
        },
        {
            fields: [],
            slug: "posts",
        },
        {
            fields: [],
            slug: "pages",
        },
    ],
    endpoints: [],
})

describe("payloadAiPlugin options", () => {
    it("registers admin config, endpoints and account fields from collection options", () => {
        const config = payloadAiPlugin({
            collections: {
                pages: {
                    update: true,
                },
                posts: true,
            },
            models: {
                defaults: {
                    claude: "claude-test",
                    google: "google-test",
                    mistral: "mistral-test",
                    openai: "openai-test",
                    openrouter: "openrouter-test",
                },
            },
        })(createBaseConfig() as never)

        expect(config.admin?.components?.beforeDashboard).toContain("@mvriu5/payload-ai/client#Dashboard")
        expect(config.admin?.custom?.payloadAiPlugin).toMatchObject({
            allowUserApiKeys: true,
            collectionSlugs: ["posts"],
            models: {
                defaults: {
                    claude: "claude-test",
                    google: "google-test",
                    mistral: "mistral-test",
                    openai: "openai-test",
                    openrouter: "openrouter-test",
                },
            },
        })
        expect(config.endpoints?.map((endpoint) => endpoint.path)).toEqual([
            "/ai-chat",
            "/ai-apply-action",
            "/ai-audit-log",
            "/ai-proposal-diff",
            "/ai-mention-suggestion",
        ])

        const usersCollection = config.collections?.find((collection) => collection.slug === "users")
        const userFieldNames = usersCollection?.fields?.map((field) => ("name" in field ? field.name : null))

        expect(userFieldNames).toContain("aiProvider")
        expect(userFieldNames).toContain("aiApiKey")
    })

    it("omits the user api key field when allowUserApiKeys is false", () => {
        const config = payloadAiPlugin({
            allowUserApiKeys: false,
        })(createBaseConfig() as never)

        const usersCollection = config.collections?.find((collection) => collection.slug === "users")
        const userFieldNames = usersCollection?.fields?.map((field) => ("name" in field ? field.name : null))

        expect(userFieldNames).toContain("aiProvider")
        expect(userFieldNames).not.toContain("aiApiKey")
        expect(config.admin?.custom?.payloadAiPlugin).toMatchObject({
            allowUserApiKeys: false,
            collectionSlugs: ["users", "posts", "pages"],
        })
    })

    it("uses managed providers without adding provider or api key user fields", () => {
        const config = payloadAiPlugin({
            providers: [
                {
                    apiKey: "server-secret",
                    baseURL: "http://localhost:11434/v1",
                    id: "ollama",
                    label: "Ollama",
                    models: [
                        { label: "Llama 3.3", value: "llama3.3" },
                        { label: "Qwen 3", value: "qwen3" },
                    ],
                    provider: "openai",
                },
            ],
        })(createBaseConfig() as never)

        const usersCollection = config.collections?.find((collection) => collection.slug === "users")
        const userFieldNames = usersCollection?.fields?.map((field) => ("name" in field ? field.name : null))
        const adminPluginConfig = config.admin?.custom?.payloadAiPlugin as Record<string, unknown>

        expect(userFieldNames).not.toContain("aiProvider")
        expect(userFieldNames).not.toContain("aiApiKey")
        expect(adminPluginConfig).toMatchObject({
            allowUserApiKeys: false,
            managedProviders: true,
            providers: [
                {
                    defaultModel: "llama3.3",
                    id: "ollama",
                    label: "Ollama",
                    models: [
                        { label: "Llama 3.3", value: "llama3.3" },
                        { label: "Qwen 3", value: "qwen3" },
                    ],
                    provider: "openai",
                },
            ],
        })
        expect(JSON.stringify(adminPluginConfig)).not.toContain("server-secret")
        expect(JSON.stringify(adminPluginConfig)).not.toContain("localhost:11434")
    })

    it("stops before dashboard and endpoint registration when disabled", () => {
        const config = payloadAiPlugin({
            disabled: true,
        })(createBaseConfig() as never)

        expect(config.admin?.components?.beforeDashboard).toBeUndefined()
        expect(config.endpoints).toEqual([])

        const usersCollection = config.collections?.find((collection) => collection.slug === "users")
        const userFieldNames = usersCollection?.fields?.map((field) => ("name" in field ? field.name : null))

        expect(userFieldNames).toContain("aiProvider")
    })

    it("registers media upload support when enabled", () => {
        const config = payloadAiPlugin({
            media: {
                acceptedMimeTypes: ["image/*"],
                collectionSlug: "media",
                enabled: true,
                maxFileSize: 1024,
            },
        })(createBaseConfig() as never)

        expect(config.endpoints?.map((endpoint) => endpoint.path)).toContain("/ai-upload-media")
        expect(config.admin?.custom?.payloadAiPlugin).toMatchObject({
            media: {
                acceptedMimeTypes: ["image/*"],
                collectionSlug: "media",
                enabled: true,
                maxFileSize: 1024,
            },
        })
    })

    it("registers a hidden usage collection when token limits are configured", () => {
        const config = payloadAiPlugin({
            maxTokenUsage: {
                perDay: 5000,
                perWeek: 25000,
                type: "site",
            },
        })(createBaseConfig() as never)

        const usageCollection = config.collections?.find((collection) => collection.slug === "payload-ai-usage")

        expect(usageCollection?.admin?.hidden).toBe(true)
        expect(usageCollection?.access?.read?.({ req: { user: { id: "user-1" } } } as never)).toBe(false)
        expect(usageCollection?.fields.map((field) => ("name" in field ? field.name : null))).toEqual([
            "userID",
            "provider",
            "model",
            "inputTokens",
            "outputTokens",
            "totalTokens",
            "recordedAt",
        ])
    })
})

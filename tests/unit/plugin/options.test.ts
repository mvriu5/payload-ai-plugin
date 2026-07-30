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
            "/ai-generate-field",
        ])

        const usersCollection = config.collections?.find((collection) => collection.slug === "users")
        const userFieldNames = usersCollection?.fields?.map((field) => ("name" in field ? field.name : null))

        expect(userFieldNames).toContain("aiProvider")
        expect(userFieldNames).toContain("aiApiKey")

        const aiProviderField = usersCollection?.fields?.find((field) => "name" in field && field.name === "aiProvider")
        const aiApiKeyField = usersCollection?.fields?.find((field) => "name" in field && field.name === "aiApiKey")
        const payloadAIField = usersCollection?.fields?.find((field) => "name" in field && field.name === "payloadAi")

        for (const field of [aiProviderField, aiApiKeyField, payloadAIField]) {
            expect(field?.admin?.condition?.({}, {}, { user: null } as never)).toBe(false)
            expect(field?.admin?.condition?.({}, {}, { user: { id: "user-1" } } as never)).toBe(true)
        }
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

    it("can disable generated field controls and their endpoint", () => {
        const baseConfig = createBaseConfig()
        baseConfig.collections[1].fields = [
            {
                name: "title",
                type: "text",
            },
        ] as never
        const config = payloadAiPlugin({
            generateFields: false,
        })(baseConfig as never)
        const posts = config.collections?.find((collection) => collection.slug === "posts")
        const title = posts?.fields.find((field) => "name" in field && field.name === "title")

        expect(config.endpoints?.map((endpoint) => endpoint.path)).not.toContain("/ai-generate-field")
        expect(title && "admin" in title ? title.admin?.components?.afterInput : undefined).toBeUndefined()
        expect(posts?.fields.some((field) => "name" in field && field.name === "payloadAi")).toBe(true)
    })

    it("can disable the embedded AI input while keeping generated field controls", () => {
        const baseConfig = {
            ...createBaseConfig(),
            globals: [
                {
                    fields: [
                        {
                            name: "headline",
                            type: "text",
                        },
                    ],
                    slug: "site-settings",
                },
            ],
        }
        baseConfig.collections[1].fields = [
            {
                name: "title",
                type: "text",
            },
        ] as never
        const config = payloadAiPlugin({
            aiInput: false,
        })(baseConfig as never)
        const posts = config.collections?.find((collection) => collection.slug === "posts")
        const title = posts?.fields.find((field) => "name" in field && field.name === "title")
        const siteSettings = config.globals?.find((global) => global.slug === "site-settings")
        const headline = siteSettings?.fields.find((field) => "name" in field && field.name === "headline")

        expect(posts?.fields.some((field) => "name" in field && field.name === "payloadAi")).toBe(false)
        expect(title && "admin" in title ? title.admin?.components?.afterInput : undefined).toHaveLength(1)
        expect(siteSettings?.fields.some((field) => "name" in field && field.name === "payloadAi")).toBe(false)
        expect(headline && "admin" in headline ? headline.admin?.components?.afterInput : undefined).toHaveLength(1)
        expect(config.endpoints?.map((endpoint) => endpoint.path)).toContain("/ai-generate-field")
        expect(config.admin?.components?.beforeDashboard).toContain("@mvriu5/payload-ai/client#Dashboard")
    })

    it("omits AI controls from auth and upload collections by default", () => {
        const baseConfig = createBaseConfig()
        baseConfig.collections[0].auth = true as never
        baseConfig.collections[0].fields = [{ name: "displayName", type: "text" }] as never
        baseConfig.collections.push({
            fields: [{ name: "alt", type: "text" }],
            slug: "media",
            upload: true,
        } as never)
        baseConfig.collections[1].fields = [{ name: "title", type: "text" }] as never

        const config = payloadAiPlugin({})(baseConfig as never)
        const users = config.collections?.find((collection) => collection.slug === "users")
        const media = config.collections?.find((collection) => collection.slug === "media")
        const posts = config.collections?.find((collection) => collection.slug === "posts")
        const hasAIInput = (fields: NonNullable<typeof users>["fields"]) =>
            fields.some((field) => "name" in field && field.name === "payloadAi")
        const generateControls = (fields: NonNullable<typeof users>["fields"], name: string) => {
            const field = fields.find((candidate) => "name" in candidate && candidate.name === name)
            return field && "admin" in field ? field.admin?.components?.afterInput : undefined
        }

        expect(hasAIInput(users?.fields || [])).toBe(false)
        expect(generateControls(users?.fields || [], "displayName")).toBeUndefined()
        expect(hasAIInput(media?.fields || [])).toBe(false)
        expect(generateControls(media?.fields || [], "alt")).toBeUndefined()
        expect(hasAIInput(posts?.fields || [])).toBe(true)
        expect(generateControls(posts?.fields || [], "title")).toHaveLength(1)
    })

    it("can enable AI controls for auth and upload collections", () => {
        const baseConfig = createBaseConfig()
        baseConfig.collections[0].auth = true as never
        baseConfig.collections[0].fields = [{ name: "displayName", type: "text" }] as never
        baseConfig.collections.push({
            fields: [{ name: "alt", type: "text" }],
            slug: "media",
            upload: true,
        } as never)

        const config = payloadAiPlugin({
            authCollections: {
                aiInput: true,
                generateFields: true,
            },
            uploadCollections: {
                aiInput: true,
                generateFields: true,
            },
        })(baseConfig as never)

        for (const [slug, fieldName] of [
            ["users", "displayName"],
            ["media", "alt"],
        ] as const) {
            const collection = config.collections?.find((candidate) => candidate.slug === slug)
            const field = collection?.fields.find((candidate) => "name" in candidate && candidate.name === fieldName)

            expect(collection?.fields.some((candidate) => "name" in candidate && candidate.name === "payloadAi")).toBe(true)
            expect(field && "admin" in field ? field.admin?.components?.afterInput : undefined).toHaveLength(1)
        }
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

    it("registers document translation controls for localized collections and globals", () => {
        const config = payloadAiPlugin({})({
            ...createBaseConfig(),
            globals: [
                {
                    fields: [{ localized: true, name: "headline", type: "text" }],
                    slug: "site-settings",
                },
            ],
            localization: {
                defaultLocale: "en",
                locales: [
                    { code: "en", label: "English" },
                    { code: "de", label: "Deutsch" },
                ],
            },
        } as never)
        const posts = config.collections?.find((collection) => collection.slug === "posts")
        const siteSettings = config.globals?.find((global) => global.slug === "site-settings")

        expect(posts?.admin?.components?.edit?.beforeDocumentControls).toBeUndefined()
        expect(siteSettings?.admin?.components?.elements?.beforeDocumentControls).toContain(
            "@mvriu5/payload-ai/client#TranslateDocumentButton"
        )
        expect(config.endpoints?.map((endpoint) => endpoint.path)).toContain("/ai-translate-document")
    })

    it("can disable document translation controls and their endpoint", () => {
        const config = payloadAiPlugin({
            translate: false,
        })({
            ...createBaseConfig(),
            globals: [
                {
                    fields: [{ localized: true, name: "headline", type: "text" }],
                    slug: "site-settings",
                },
            ],
            localization: {
                defaultLocale: "en",
                locales: [
                    { code: "en", label: "English" },
                    { code: "de", label: "Deutsch" },
                ],
            },
        } as never)
        const siteSettings = config.globals?.find((global) => global.slug === "site-settings")

        expect(siteSettings?.admin?.components?.elements?.beforeDocumentControls).toBeUndefined()
        expect(config.endpoints?.map((endpoint) => endpoint.path)).not.toContain("/ai-translate-document")
    })
})

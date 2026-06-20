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

        expect(config.admin?.components?.beforeDashboard).toContain("payload-ai-plugin/client#AIInput")
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
})

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { resolveAIRequestContext } from "../../../../src/features/providers/requestContext.js"
import { createMockRequest } from "../../../fixtures/handler.js"

const getExceededTokenUsageLimit = vi.hoisted(() => vi.fn())
const getModel = vi.hoisted(() => vi.fn())
const recordTokenUsage = vi.hoisted(() => vi.fn())
const originalOpenAIKey = process.env.OPENAI_API_KEY

vi.mock("../../../../src/features/providers/runtime.js", async () => ({
    ...(await vi.importActual<typeof import("../../../../src/features/providers/runtime.js")>("../../../../src/features/providers/runtime.js")),
    getModel,
}))

vi.mock("../../../../src/features/tokenUsage.js", async () => ({
    ...(await vi.importActual<typeof import("../../../../src/features/tokenUsage.js")>("../../../../src/features/tokenUsage.js")),
    getExceededTokenUsageLimit,
    recordTokenUsage,
}))

describe("AI request context", () => {
    beforeEach(() => {
        vi.clearAllMocks()
        delete process.env.OPENAI_API_KEY
        getExceededTokenUsageLimit.mockResolvedValue(null)
        getModel.mockResolvedValue({ model: "test" })
    })

    afterEach(() => {
        if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
        else process.env.OPENAI_API_KEY = originalOpenAIKey
    })

    it("resolves a legacy user provider and records usage through one context", async () => {
        const req = createMockRequest()
        const resolution = await resolveAIRequestContext({
            options: {
                maxTokenUsage: {
                    perDay: 1000,
                    type: "user",
                },
            },
            req,
            requestedModel: "gpt-test",
            user: {
                aiApiKey: "user-key",
                aiProvider: "openai",
                id: "user-1",
            },
        })

        expect(resolution.ok).toBe(true)
        if (!resolution.ok) return

        expect(resolution.context).toMatchObject({
            managedProvider: null,
            modelID: "gpt-test",
            provider: "openai",
            providerID: "openai",
        })
        await expect(resolution.context.loadModel()).resolves.toEqual({ model: "test" })
        expect(getModel).toHaveBeenCalledWith({
            apiKey: "user-key",
            model: "gpt-test",
            provider: "openai",
        })

        await resolution.context.recordUsage({ totalTokens: 12 })
        expect(recordTokenUsage).toHaveBeenCalledWith({
            model: "gpt-test",
            provider: "openai",
            req,
            usage: { totalTokens: 12 },
            userID: "user-1",
        })
    })

    it("uses the first managed provider with its configured model and base URL", async () => {
        const resolution = await resolveAIRequestContext({
            options: {
                providers: [
                    {
                        apiKey: "managed-key",
                        baseURL: "https://ai.example.test",
                        defaultModel: "managed-model",
                        id: "editorial",
                        label: "Editorial",
                        models: [{ label: "Managed", value: "managed-model" }],
                        provider: "openai",
                    },
                ],
            },
            req: createMockRequest(),
            user: {
                id: "user-1",
            },
        })

        expect(resolution.ok).toBe(true)
        if (!resolution.ok) return

        expect(resolution.context).toMatchObject({
            modelID: "managed-model",
            provider: "openai",
            providerID: "editorial",
        })
        await resolution.context.loadModel()
        expect(getModel).toHaveBeenCalledWith({
            apiKey: "managed-key",
            baseURL: "https://ai.example.test",
            model: "managed-model",
            provider: "openai",
        })
    })

    it("rejects models that are not configured for a managed provider", async () => {
        const resolution = await resolveAIRequestContext({
            options: {
                providers: [
                    {
                        apiKey: "managed-key",
                        defaultModel: "managed-model",
                        id: "editorial",
                        label: "Editorial",
                        models: [{ label: "Managed", value: "managed-model" }],
                        provider: "openai",
                    },
                ],
            },
            req: createMockRequest(),
            requestedModel: "unsupported-model",
            requestedProvider: "editorial",
            user: {
                id: "user-1",
            },
        })

        expect(resolution).toEqual({
            error: {
                code: "unsupported_model",
                message: 'Unsupported model "unsupported-model" for AI provider "editorial".',
            },
            ok: false,
        })
        expect(getModel).not.toHaveBeenCalled()
    })

    it("returns provider details when no API key is configured", async () => {
        const resolution = await resolveAIRequestContext({
            options: {},
            req: createMockRequest(),
            user: {
                aiProvider: "openai",
                id: "user-1",
            },
        })

        expect(resolution).toMatchObject({
            error: {
                code: "missing_api_key",
                managedProvider: false,
                provider: "openai",
                providerID: "openai",
            },
            ok: false,
        })
    })

    it("stops before provider resolution when the token limit is exceeded", async () => {
        getExceededTokenUsageLimit.mockResolvedValue({
            limit: 100,
            period: "day",
            used: 120,
        })

        const resolution = await resolveAIRequestContext({
            options: {
                maxTokenUsage: {
                    perDay: 100,
                    type: "user",
                },
            },
            req: createMockRequest(),
            requestedProvider: "invalid",
            user: {
                id: "user-1",
            },
        })

        expect(resolution).toEqual({
            error: {
                code: "token_limit",
                message: "AI token usage limit reached.",
                tokenLimit: {
                    limit: 100,
                    period: "day",
                    used: 120,
                },
            },
            ok: false,
        })
        expect(getModel).not.toHaveBeenCalled()
    })
})

import { describe, expect, it, vi } from "vitest"

import {
    getExceededTokenUsageLimit,
    recordTokenUsage,
    resolveMaxTokenUsageOptions,
    tokenUsageCollectionSlug,
} from "../../../src/ai/tokenUsage.js"
import { createMockRequest } from "../../fixtures/handler.js"

const now = new Date("2026-07-02T12:00:00.000Z")

describe("AI token usage", () => {
    it("validates token usage options", () => {
        expect(resolveMaxTokenUsageOptions({ perDay: 1000.9, type: "user" })).toEqual({
            perDay: 1000,
            type: "user",
        })
        expect(() => resolveMaxTokenUsageOptions({ type: "site" })).toThrow("must configure perDay, perWeek, or both")
        expect(() => resolveMaxTokenUsageOptions({ perWeek: -1, type: "user" })).toThrow("maxTokenUsage.perWeek must be a positive number")
    })

    it("enforces daily limits per user", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [
                {
                    recordedAt: "2026-07-02T08:00:00.000Z",
                    totalTokens: 700,
                },
                {
                    recordedAt: "2026-07-02T10:00:00.000Z",
                    totalTokens: 300,
                },
            ],
            hasNextPage: false,
        })
        const req = createMockRequest({ find })

        await expect(
            getExceededTokenUsageLimit({
                maxTokenUsage: {
                    perDay: 1000,
                    type: "user",
                },
                now,
                req,
                userID: "user-1",
            })
        ).resolves.toEqual({
            limit: 1000,
            period: "day",
            used: 1000,
        })
        expect(find).toHaveBeenCalledWith(
            expect.objectContaining({
                collection: tokenUsageCollectionSlug,
                where: {
                    and: [
                        {
                            recordedAt: {
                                greater_than_equal: "2026-07-01T12:00:00.000Z",
                            },
                        },
                        {
                            userID: {
                                equals: "user-1",
                            },
                        },
                    ],
                },
            })
        )
    })

    it("enforces weekly site limits while excluding old daily usage", async () => {
        const find = vi.fn().mockResolvedValue({
            docs: [
                {
                    recordedAt: "2026-06-27T12:00:00.000Z",
                    totalTokens: 800,
                },
                {
                    recordedAt: "2026-07-02T10:00:00.000Z",
                    totalTokens: 200,
                },
            ],
            hasNextPage: false,
        })
        const req = createMockRequest({ find })

        await expect(
            getExceededTokenUsageLimit({
                maxTokenUsage: {
                    perDay: 500,
                    perWeek: 1000,
                    type: "site",
                },
                now,
                req,
                userID: "user-1",
            })
        ).resolves.toEqual({
            limit: 1000,
            period: "week",
            used: 1000,
        })
        expect(find.mock.calls[0]?.[0]?.where.and).toHaveLength(1)
    })

    it("records normalized provider usage", async () => {
        const create = vi.fn().mockResolvedValue({ id: "usage-1" })
        const req = createMockRequest({ create })

        await recordTokenUsage({
            model: "gpt-test",
            now,
            provider: "openai",
            req,
            usage: {
                inputTokens: 10.8,
                outputTokens: 5.2,
            },
            userID: 42,
        })

        expect(create).toHaveBeenCalledWith({
            collection: tokenUsageCollectionSlug,
            data: {
                inputTokens: 10,
                model: "gpt-test",
                outputTokens: 5,
                provider: "openai",
                recordedAt: now.toISOString(),
                totalTokens: 15,
                userID: "42",
            },
            overrideAccess: true,
            req,
        })
    })
})

import type { PayloadHandler } from "payload"

export type MaxTokenUsageOptions = {
    perDay?: number
    perWeek?: number
    type: "site" | "user"
}

export type ResolvedMaxTokenUsageOptions = {
    perDay?: number
    perWeek?: number
    type: "site" | "user"
}

export type TokenUsageData = {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}

type TokenUsageDocument = {
    recordedAt?: string
    totalTokens?: number
}

type TokenUsageLimit = {
    limit: number
    period: "day" | "week"
    used: number
}

export const tokenUsageCollectionSlug = "payload-ai-usage"

const dayInMilliseconds = 24 * 60 * 60 * 1000
const weekInMilliseconds = 7 * dayInMilliseconds

const resolvePositiveInteger = (value: number | undefined, path: string) => {
    if (value === undefined) return undefined
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${path} must be a positive number.`)

    return Math.floor(value)
}

export const resolveMaxTokenUsageOptions = (options?: MaxTokenUsageOptions): ResolvedMaxTokenUsageOptions | undefined => {
    if (!options) return undefined
    if (!["site", "user"].includes(options.type)) throw new Error('maxTokenUsage.type must be either "user" or "site".')

    const perDay = resolvePositiveInteger(options.perDay, "maxTokenUsage.perDay")
    const perWeek = resolvePositiveInteger(options.perWeek, "maxTokenUsage.perWeek")

    if (!perDay && !perWeek) throw new Error("maxTokenUsage must configure perDay, perWeek, or both.")

    return {
        ...(perDay ? { perDay } : {}),
        ...(perWeek ? { perWeek } : {}),
        type: options.type,
    }
}

const normalizeTokenCount = (value?: number) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0)

const getTokenCount = (usage: TokenUsageData) =>
    typeof usage.totalTokens === "number"
        ? normalizeTokenCount(usage.totalTokens)
        : normalizeTokenCount(usage.inputTokens) + normalizeTokenCount(usage.outputTokens)

export const getExceededTokenUsageLimit = async ({
    maxTokenUsage,
    now = new Date(),
    req,
    userID,
}: {
    maxTokenUsage?: ResolvedMaxTokenUsageOptions
    now?: Date
    req: Parameters<PayloadHandler>[0]
    userID: number | string
}): Promise<TokenUsageLimit | null> => {
    if (!maxTokenUsage) return null

    const dayStart = new Date(now.getTime() - dayInMilliseconds)
    const weekStart = new Date(now.getTime() - weekInMilliseconds)
    const queryStart = maxTokenUsage.perWeek ? weekStart : dayStart
    let page = 1
    let usagePerDay = 0
    let usagePerWeek = 0

    while (true) {
        const result = (await req.payload.find({
            collection: tokenUsageCollectionSlug as never,
            depth: 0,
            limit: 500,
            overrideAccess: true,
            page,
            req,
            where: {
                and: [
                    {
                        recordedAt: {
                            greater_than_equal: queryStart.toISOString(),
                        },
                    },
                    ...(maxTokenUsage.type === "user"
                        ? [
                              {
                                  userID: {
                                      equals: String(userID),
                                  },
                              },
                          ]
                        : []),
                ],
            },
        })) as unknown as {
            docs?: TokenUsageDocument[]
            hasNextPage?: boolean
            nextPage?: number | null
        }

        for (const document of result.docs || []) {
            const tokenCount = getTokenCount(document)
            usagePerWeek += tokenCount

            if (document.recordedAt && new Date(document.recordedAt).getTime() >= dayStart.getTime()) {
                usagePerDay += tokenCount
            }
        }

        if (!result.hasNextPage || !result.nextPage) break
        page = result.nextPage
    }

    if (maxTokenUsage.perDay && usagePerDay >= maxTokenUsage.perDay) {
        return {
            limit: maxTokenUsage.perDay,
            period: "day",
            used: usagePerDay,
        }
    }

    if (maxTokenUsage.perWeek && usagePerWeek >= maxTokenUsage.perWeek) {
        return {
            limit: maxTokenUsage.perWeek,
            period: "week",
            used: usagePerWeek,
        }
    }

    return null
}

export const recordTokenUsage = async ({
    model,
    now = new Date(),
    provider,
    req,
    usage,
    userID,
}: {
    model: string
    now?: Date
    provider: string
    req: Parameters<PayloadHandler>[0]
    usage: TokenUsageData
    userID: number | string
}) => {
    const totalTokens = getTokenCount(usage)
    if (!totalTokens) return

    await req.payload.create({
        collection: tokenUsageCollectionSlug as never,
        data: {
            inputTokens: typeof usage.inputTokens === "number" ? normalizeTokenCount(usage.inputTokens) : undefined,
            model,
            outputTokens: typeof usage.outputTokens === "number" ? normalizeTokenCount(usage.outputTokens) : undefined,
            provider,
            recordedAt: now.toISOString(),
            totalTokens,
            userID: String(userID),
        } as never,
        overrideAccess: true,
        req,
    })
}

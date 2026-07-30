import { createHash } from "node:crypto"

import type { SystemModelMessage } from "ai"

import type { AIProvider } from "./providerOptions.js"

type PromptCacheContext = {
    cacheable: Record<string, unknown>[]
    dynamic: Record<string, unknown>[]
}

export type PromptCacheProviderOptions = NonNullable<SystemModelMessage["providerOptions"]>

const getContextKey = (context: Record<string, unknown>) => {
    return [context.type, context.parent, context.collection, context.slug].filter(Boolean).join(":") || JSON.stringify(context)
}

export const splitPromptCacheContext = (mentionContext: Record<string, unknown>[]): PromptCacheContext => {
    const cacheable: Record<string, unknown>[] = []
    const dynamic: Record<string, unknown>[] = []
    const cacheableKeys = new Set<string>()
    const addCacheable = (context: Record<string, unknown>) => {
        const key = getContextKey(context)
        if (cacheableKeys.has(key)) return

        cacheableKeys.add(key)
        cacheable.push(context)
    }

    for (const context of mentionContext) {
        if (["block", "collection"].includes(String(context.type))) {
            addCacheable(context)
            continue
        }

        if (context.type === "global" && "doc" in context) {
            const { doc, ...schema } = context
            addCacheable(schema)
            dynamic.push({
                doc,
                slug: context.slug,
                type: "globalDocument",
            })
            continue
        }

        if (context.type === "global") {
            addCacheable(context)
            continue
        }

        if (context.type === "mediaAttachment" && context.schema && typeof context.schema === "object") {
            addCacheable(context.schema as Record<string, unknown>)
            const { schema: _schema, ...attachmentContext } = context
            dynamic.push(attachmentContext)
            continue
        }

        dynamic.push(context)
    }

    return {
        cacheable,
        dynamic,
    }
}

const withAnthropicCacheControl = (message: SystemModelMessage, enabled: boolean, provider: AIProvider): SystemModelMessage => {
    if (!enabled || provider !== "claude") return message

    return {
        ...message,
        providerOptions: {
            anthropic: {
                cacheControl: {
                    type: "ephemeral",
                },
            },
        },
    }
}

export const createCachedSystemMessages = ({
    cacheableContext,
    cacheableInstructions,
    dynamicInstructions,
    enabled,
    provider,
    staticInstructions,
}: {
    cacheableContext: Record<string, unknown>[]
    cacheableInstructions: string[]
    dynamicInstructions: string[]
    enabled: boolean
    provider: AIProvider
    staticInstructions: string[]
}): SystemModelMessage[] => {
    const messages = [
        withAnthropicCacheControl(
            {
                content: staticInstructions.join("\n"),
                role: "system",
            },
            enabled,
            provider
        ),
    ]
    const scopedContent = [
        ...(cacheableContext.length ? ["Payload schema references JSON. Use exact field names and values:", JSON.stringify(cacheableContext)] : []),
        ...cacheableInstructions,
    ]

    if (scopedContent.length > 0) {
        messages.push(
            withAnthropicCacheControl(
                {
                    content: scopedContent.join("\n"),
                    role: "system",
                },
                enabled,
                provider
            )
        )
    }
    if (dynamicInstructions.length > 0) {
        messages.push({
            content: dynamicInstructions.join("\n"),
            role: "system",
        })
    }

    return messages
}

export const createPromptCacheProviderOptions = ({
    cacheKeyParts,
    enabled,
    model,
    provider,
}: {
    cacheKeyParts: unknown[]
    enabled: boolean
    model: string
    provider: AIProvider
}): PromptCacheProviderOptions | undefined => {
    if (!enabled) return undefined

    if (provider === "openai") {
        const digest = createHash("sha256")
            .update(JSON.stringify(["payload-ai-v1", model, ...cacheKeyParts]))
            .digest("hex")
            .slice(0, 32)

        return {
            openai: {
                promptCacheKey: `payload-ai-${digest}`,
            },
        }
    }

    if (provider === "openrouter" && model.toLowerCase().startsWith("anthropic/")) {
        return {
            openrouter: {
                cache_control: {
                    type: "ephemeral",
                },
            },
        }
    }

    return undefined
}

import type { SystemModelMessage } from "ai"

import type { AIProvider } from "../../features/providers/options.js"
import {
    createCachedSystemMessages,
    createPromptCacheProviderOptions,
    splitPromptCacheContext,
    type PromptCacheProviderOptions,
} from "../../features/promptCaching.js"
import { redactSensitiveData } from "../../features/sensitiveData.js"

export const createChatPromptContext = ({
    chatIntent,
    collectionAliasMap,
    focusedRequiredFieldsByCollection,
    focusedTitleFieldByCollection,
    intentToolName,
    likelyCollectionMatches,
    mentionContext,
    modelID,
    promptCaching,
    provider,
    scopedToolNames,
}: {
    chatIntent: string
    collectionAliasMap: Record<string, string>
    focusedRequiredFieldsByCollection: Record<string, unknown>
    focusedTitleFieldByCollection: Record<string, unknown>
    intentToolName?: string
    likelyCollectionMatches: string[]
    mentionContext: unknown
    modelID: string
    promptCaching: boolean
    provider: AIProvider
    scopedToolNames: Set<string>
}): {
    dynamicMentionContext: Record<string, unknown>[]
    promptCacheProviderOptions: PromptCacheProviderOptions | undefined
    system: SystemModelMessage[]
} => {
    const sanitizedMentionContext = redactSensitiveData(mentionContext) as Record<string, unknown>[]
    const { cacheable: cacheableMentionContext, dynamic: dynamicMentionContext } = splitPromptCacheContext(sanitizedMentionContext)
    const staticSystemInstructions = [
        "You are a Payload CMS assistant. Inspect schema/content with tools before proposing writes.",
        "Mentions define the active CMS scope. Locale mentions define active locale; multiple locales require localizedData keyed by locale.",
        "Writes are proposals only. Never claim changes were applied before user confirmation.",
        "Uploaded media attachments appear in context as mediaAttachment entries. Use their exact IDs for upload fields.",
        "If an uploaded media document has editable descriptive fields, propose an update to that media document with suitable values.",
        "If a collection has a required `slug` field and the user does not provide it, generate a URL-friendly slug from the title or from the first meaningful word of the prompt.",
        "For create/update/delete requests, you must use proposal tools. Do not end with plain text if the user asked for a content change.",
        "If the user asks to create, update, refine, translate, remove, or delete content, produce at least one proposal tool call unless blocked by missing schema information or permissions.",
        "Put concrete field values only in tool data, not visible text.",
        "For blocks fields: use exact blockType values from schema, exact field names, and complete objects for required block fields.",
        "For arrays: every item must be an object matching the child field schema, not free text.",
        "If schema details are missing, call listCollections/listGlobals with a slug before proposing. If an inferred collection schema is already present in context, use it directly.",
        "Read tools return compact identity fields by default. Request only the additional fields needed for the current task; full schemas remain available separately.",
        "If a proposal tool returns retryable=true, correct only repair.issues and call the same proposal tool once more. If retryable=false, do not retry that tool target.",
    ]
    const cacheableSystemInstructions = [
        `Collection aliases: ${JSON.stringify(collectionAliasMap)}.`,
        `Focused required create fields: ${JSON.stringify(focusedRequiredFieldsByCollection)}.`,
        `Focused title fields: ${JSON.stringify(focusedTitleFieldByCollection)}. Infer concise titles when needed.`,
    ]
    const dynamicSystemInstructions = [
        `Likely collection matches for this prompt: ${JSON.stringify(likelyCollectionMatches)}.`,
        `Request intent: ${chatIntent}. Preferred proposal tool: ${intentToolName || "none"}.`,
        "Visible response: plain text, under 40 words, no Markdown, no proposed content.",
    ]

    return {
        dynamicMentionContext,
        promptCacheProviderOptions: createPromptCacheProviderOptions({
            cacheKeyParts: [cacheableMentionContext, cacheableSystemInstructions, [...scopedToolNames].sort()],
            enabled: promptCaching,
            model: modelID,
            provider,
        }),
        system: createCachedSystemMessages({
            cacheableContext: cacheableMentionContext,
            cacheableInstructions: cacheableSystemInstructions,
            dynamicInstructions: dynamicSystemInstructions,
            enabled: promptCaching,
            provider,
            staticInstructions: staticSystemInstructions,
        }),
    }
}

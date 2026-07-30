export { collectBlocks, describeCollectionLikeConfig, describeCollectionLikeSummary, type CollectionLikeConfig, type FieldConfig } from "./description.js"
export { getAllowedCollectionSlugs, getMentionContext, type ChatMention } from "./mentions.js"
export { createSchemaContextRegistry, type SchemaContextRegistry } from "./registry.js"

export const buildPromptWithMentionContext = ({ mentionContext, prompt }: { mentionContext: Record<string, unknown>[]; prompt: string }) => {
    if (mentionContext.length === 0) return prompt

    return ["Selected Payload references JSON. Treat inline reference labels as these entities:", JSON.stringify(mentionContext), prompt].join("\n\n")
}

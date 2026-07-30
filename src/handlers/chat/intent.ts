import type { ChatIntent, ToolChoice } from "./types.js"

const regexSpecialCharactersPattern = /[.*+?^${}()|[\]\\]/g

export const createCollectionAliasMap = (collections: Array<{ labels?: { plural?: unknown; singular?: unknown }; slug: string }>) => {
    const aliasMap = new Map<string, string>()

    const addAlias = (alias: string | undefined, slug: string) => {
        const normalizedAlias = alias?.trim().toLowerCase()
        if (!normalizedAlias) return
        if (!aliasMap.has(normalizedAlias)) aliasMap.set(normalizedAlias, slug)
    }

    for (const collection of collections) {
        addAlias(collection.slug, collection.slug)
        addAlias(collection.slug.replace(/-/g, " "), collection.slug)

        const singular = typeof collection.labels?.singular === "string" ? collection.labels.singular : undefined
        const plural = typeof collection.labels?.plural === "string" ? collection.labels.plural : undefined

        addAlias(singular, collection.slug)
        addAlias(plural, collection.slug)

        if (singular?.endsWith("s")) addAlias(singular.slice(0, -1), collection.slug)
        if (plural?.endsWith("s")) addAlias(plural.slice(0, -1), collection.slug)
    }

    return Object.fromEntries(aliasMap.entries())
}

export const getLikelyCollectionMatches = ({ aliasMap, prompt }: { aliasMap: Record<string, string>; prompt: string }) => {
    const normalizedPrompt = prompt.toLowerCase()
    const matches = new Set<string>()
    const aliases = Object.keys(aliasMap).sort((a, b) => b.length - a.length)
    const aliasPattern =
        aliases.length > 0 ? new RegExp(aliases.map((alias) => alias.replace(regexSpecialCharactersPattern, "\\$&")).join("|"), "g") : null

    if (!aliasPattern) return []

    for (const match of normalizedPrompt.matchAll(aliasPattern)) {
        const slug = aliasMap[match[0]]
        if (slug) matches.add(slug)
    }

    return [...matches]
}

const normalizeIntentText = (prompt: string) =>
    prompt
        .toLowerCase()
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")

const deleteIntentPattern = /\b(?:delete|remove|erase|destroy|discard|purge|loesch\w*|losch\w*|entfern\w*|rausnehm\w*|wegnehm\w*|verwerf\w*)\b/
const createIntentPattern =
    /\b(?:create|build|generate|draft|compose|author|write|make|new|erstell\w*|anleg\w*|erzeug\w*|generier\w*|entwerf\w*|verfass\w*|schreib\w*|neu)\b/
const updateIntentPattern =
    /\b(?:update|edit|change|modify|revise|refine|rewrite|translate|replace|rename|correct|fix|set|publish|unpublish|aktualisier\w*|aender\w*|bearbeit\w*|anpass\w*|ueberarbeit\w*|uberarbeit\w*|umschreib\w*|uebersetz\w*|ubersetz\w*|ersetz\w*|umbenenn\w*|korrigier\w*|reparier\w*|setz\w*|veroeffentlich\w*|veroffentlich\w*|zurueckzieh\w*|zuruckzieh\w*)\b/
const additiveIntentPattern =
    /\b(?:add|insert|append|attach|assign|link|include|extend|ergaenz\w*|erganz\w*|hinzufueg\w*|hinzufug\w*|einfueg\w*|einfug\w*|anhaeng\w*|anhang\w*|zuweis\w*|verknuepf\w*|verknupf\w*)\b/
const searchIntentPattern =
    /\b(?:search|find|lookup|locate|list|show|fetch|browse|query|such\w*|find\w*|nachschlag\w*|auflist\w*|anzeig\w*|zeig\w*|hol\w*|durchsuch\w*)\b/
const separableDeleteIntentPattern = /\b(?:nimm|nehm\w*)\b(?:\s+\w+){0,8}\s+(?:raus|weg)\b/
const separableUpdateIntentPattern =
    /\b(?:pass(?:e|t|en|st)?\b(?:\s+\w+){0,8}\s+an|fueg\w*\b(?:\s+\w+){0,8}\s+(?:ein|hinzu)|haeng\w*\b(?:\s+\w+){0,8}\s+an|weis\w*\b(?:\s+\w+){0,8}\s+zu)\b/

export const getChatIntent = ({
    hasCurrentDocument,
    hasCurrentGlobal,
    prompt,
}: {
    hasCurrentDocument: boolean
    hasCurrentGlobal: boolean
    prompt: string
}): ChatIntent => {
    const normalizedPrompt = normalizeIntentText(prompt)

    if (deleteIntentPattern.test(normalizedPrompt) || separableDeleteIntentPattern.test(normalizedPrompt)) {
        return hasCurrentGlobal ? "read" : "delete"
    }
    if (createIntentPattern.test(normalizedPrompt)) {
        if (hasCurrentGlobal) return "updateGlobal"
        if (hasCurrentDocument) return "update"
        return "create"
    }
    if (updateIntentPattern.test(normalizedPrompt) || additiveIntentPattern.test(normalizedPrompt) || separableUpdateIntentPattern.test(normalizedPrompt)) {
        return hasCurrentGlobal ? "updateGlobal" : "update"
    }
    if (searchIntentPattern.test(normalizedPrompt)) return "search"
    return "read"
}

export const getIntentToolChoice = ({
    hasKnownCollection,
    hasKnownDocument,
    hasKnownGlobal,
    intent,
}: {
    hasKnownCollection: boolean
    hasKnownDocument: boolean
    hasKnownGlobal: boolean
    intent: ChatIntent
}): ToolChoice | undefined => {
    if (intent === "create" && hasKnownCollection) return { toolName: "proposeCreateDoc", type: "tool" }
    if (intent === "update" && hasKnownDocument) return { toolName: "proposeUpdateDoc", type: "tool" }
    if (intent === "delete" && hasKnownDocument) return { toolName: "proposeDeleteDoc", type: "tool" }
    if (intent === "updateGlobal" && hasKnownGlobal) return { toolName: "proposeUpdateGlobal", type: "tool" }
    return undefined
}

export const getToolNamesForIntent = ({
    hasAttachments,
    hasKnownCollection,
    hasCurrentDocument,
    hasCurrentGlobal,
    intent,
}: {
    hasAttachments: boolean
    hasKnownCollection: boolean
    hasCurrentDocument: boolean
    hasCurrentGlobal: boolean
    intent: ChatIntent
}) => {
    if (hasCurrentGlobal) {
        return new Set(intent === "updateGlobal" ? ["getGlobal", "listGlobals", "proposeUpdateGlobal"] : ["getGlobal", "listGlobals"])
    }
    if (hasCurrentDocument) {
        if (intent === "delete") return new Set(["getDoc", "proposeDeleteDoc"])
        if (intent === "update" || intent === "create") return new Set(["getDoc", "listCollections", "proposeUpdateDoc"])
        return new Set(["getDoc", "listCollections"])
    }
    if (hasKnownCollection) {
        if (intent === "create") return new Set(["getDoc", "listCollections", "proposeCreateDoc", "searchDocs"])
        if (intent === "update") return new Set(["getDoc", "listCollections", "proposeUpdateDoc", "searchDocs"])
        if (intent === "delete") return new Set(["getDoc", "proposeDeleteDoc", "searchDocs"])
        return new Set(["getDoc", "listCollections", "searchDocs"])
    }

    const toolNames =
        intent === "create"
            ? new Set(["getDoc", "listCollections", "proposeCreateDoc", "searchDocs"])
            : intent === "update"
              ? new Set(["getDoc", "getGlobal", "listCollections", "listGlobals", "proposeUpdateDoc", "proposeUpdateGlobal", "searchDocs"])
              : intent === "delete"
                ? new Set(["getDoc", "listCollections", "proposeDeleteDoc", "searchDocs"])
                : new Set(["getDoc", "getGlobal", "listCollections", "listGlobals", "searchDocs"])

    if (hasAttachments && (intent === "create" || intent === "update")) toolNames.add("proposeUpdateDoc")
    return toolNames
}

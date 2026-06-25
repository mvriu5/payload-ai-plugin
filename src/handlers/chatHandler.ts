import type { PayloadHandler } from "payload"

import { stepCountIs, streamText } from "ai"
import { z } from "zod"

import { signAIActionProposal, type AIActionSignature } from "../ai/proposalSigning.js"
import { isAIProvider, type AIModelConfig, type AIProvider } from "../ai/providerOptions.js"
import { getModel, getProviderConfig } from "../ai/providerRuntime.js"
import { containsSensitiveData } from "../ai/sensitiveData.js"
import { isCollectionActionAllowed, type CollectionAction, type ResolvedCollectionPermissionMap } from "../payload/collectionPermissions.js"
import type { CollectionConfig as ProposalCollectionConfig, FieldConfig as ProposalFieldConfig } from "../payload/normalizeData.js"
import { prepareProposalWriteData } from "../payload/proposalData.js"
import {
    buildPromptWithMentionContext,
    collectBlocks,
    describeCollectionLikeConfig,
    describeCollectionLikeSummary,
    getAllowedCollectionSlugs,
    getMentionContext,
    type ChatMention,
    type FieldConfig,
} from "../payload/schemaContext.js"
import { getLogPreview, logHandlerEvent } from "../payload/logging.js"
import { type ProposalValidationIssue } from "../payload/proposalData.js"
import { getOptionValue, getSafeProposalLabel, hasLocalizedData, hasValueAtPath, isRecord, setValueAtPath } from "../payload/shared.js"

type ChatBody = {
    attachments?: ChatMediaAttachment[]
    mentions?: ChatMention[]
    model?: string
    prompt?: string
    provider?: string
}

type ChatMediaAttachment = {
    collection?: string
    filename?: string
    filesize?: number
    id?: string
    mimeType?: string
    type?: "media"
    url?: string
}

type User = {
    aiApiKey?: string | null
    aiProvider?: AIProvider | string | null
}

type ChatDebug = {
    model: string
    provider: string
    tools: string[]
}

type ToolFailure = {
    collection?: string
    details?: Record<string, unknown>
    message: string
    slug?: string
    tool: string
}

type ChatDebugPayload = {
    activeLocale?: string
    model: string
    proposalCount: number
    provider: string
    reason: "model_did_not_call_tool" | "proposal_created" | "tool_validation_failed" | "write_intent_without_tool_call"
    selectedLocales: string[]
    toolFailures: ToolFailure[]
    usage?: TokenUsage | null
}

type CollectionInput = {
    collection: string
}

type DataInput = {
    data: Record<string, unknown>
}

type DocIDInput = {
    id: string
}

type LabelInput = {
    label: string
}

type SlugInput = {
    slug: string
}

type OptionalSlugInput = {
    slug?: string
}

type LocalizedDataInput = Record<string, Record<string, unknown>>

type TokenUsage = {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}

type ProposalToolName = "proposeCreateDoc" | "proposeDeleteDoc" | "proposeUpdateDoc" | "proposeUpdateGlobal"

type ToolChoice = {
    toolName: ProposalToolName
    type: "tool"
}

type RequiredFieldInfo = {
    defaultValue?: unknown
    isTitleField?: boolean
    localized: boolean
    options?: (string | { label?: unknown; value?: string })[]
    path: string
    type?: string
}

type BlockFieldConfig = ProposalFieldConfig & {
    blocks?: Array<{
        fields?: ProposalFieldConfig[]
        slug: string
    }>
    fields?: ProposalFieldConfig[]
    name?: string
    type?: string
}

type RelationshipTargetReference = {
    collection: string
    id: number | string
    path: string
}

type ProposalWritePayload =
    | {
          data: Record<string, unknown>
          localizedData?: never
      }
    | {
          data?: never
          localizedData: LocalizedDataInput
      }

const nonEmptyLocalizedDataSchema = z.record(z.string(), z.record(z.string(), z.unknown())).refine((value) => Object.keys(value).length > 0, {
    message: "localizedData must include at least one locale entry.",
})

export type ActionProposal = (
    | ({
          action: "create"
          collection: string
          label: string
      } & ProposalWritePayload)
    | {
          action: "delete"
          collection: string
          id: string
          label: string
      }
    | ({
          action: "update"
          collection: string
          id: string
          label: string
      } & ProposalWritePayload)
    | ({
          action: "updateGlobal"
          label: string
          slug: string
      } & ProposalWritePayload)
) & {
    _aiSignature?: AIActionSignature
    locale?: string
}

type ChatOptions = {
    allowUserApiKeys?: boolean
    collections?: ResolvedCollectionPermissionMap
    maxOutputTokens?: number
    models?: AIModelConfig
}

const e2eModeEnabled = () => process.env.PAYLOAD_AI_E2E_MODE === "true"

const createSSEEventStream = (
    events: Array<{
        data: unknown
        event: string
    }>
) => {
    const encoder = new TextEncoder()

    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const { data, event } of events) {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            }

            controller.close()
        },
    })
}

const getChatCompletionReason = ({
    proposalCount,
    toolFailures,
    writeIntent,
}: {
    proposalCount: number
    toolFailures: ToolFailure[]
    writeIntent: boolean
}) => {
    if (proposalCount > 0) return "proposal_created" as const
    if (toolFailures.length > 0) return "tool_validation_failed" as const
    if (writeIntent) return "write_intent_without_tool_call" as const
    return "model_did_not_call_tool" as const
}

const createDebugPayload = ({
    activeLocale,
    debug,
    proposalCount,
    selectedLocales,
    toolFailures,
    usage,
    writeIntent,
}: {
    activeLocale?: string
    debug: ChatDebug
    proposalCount: number
    selectedLocales: string[]
    toolFailures: ToolFailure[]
    usage?: TokenUsage | null
    writeIntent: boolean
}): ChatDebugPayload => ({
    activeLocale,
    model: debug.model,
    proposalCount,
    provider: debug.provider,
    reason: getChatCompletionReason({
        proposalCount,
        toolFailures,
        writeIntent,
    }),
    selectedLocales,
    toolFailures,
    usage,
})

const createE2EChatResponse = ({ prompt, selectedLocales }: { prompt: string; selectedLocales: string[] }) => {
    const normalizedPrompt = prompt.toLowerCase()
    const wantsCreatePost = normalizedPrompt.includes("post") && (normalizedPrompt.includes("create") || normalizedPrompt.includes("erstell"))
    const mentionsMars = normalizedPrompt.includes("mars")
    const multipleLocales = selectedLocales.length > 1
    const activeLocale = selectedLocales.at(-1)
    const proposalLabel = multipleLocales
        ? normalizedPrompt.includes("locale review")
            ? "Create localized locale review draft post about Mars"
            : "Create localized draft post about Mars"
        : normalizedPrompt.includes("apply flow")
          ? "Create apply flow draft post about Mars"
          : normalizedPrompt.includes("proposal review")
            ? "Create proposal review draft post about Mars"
            : "Create draft post about Mars"

    const proposal =
        wantsCreatePost && mentionsMars
            ? signAIActionProposal(
                  multipleLocales
                      ? {
                            action: "create",
                            collection: "posts",
                            label: proposalLabel,
                            localizedData: Object.fromEntries(
                                selectedLocales.map((locale) => [
                                    locale,
                                    {
                                        content: locale === "de" ? "Mars ist der vierte Planet von der Sonne." : "Mars is the fourth planet from the Sun.",
                                        excerpt: locale === "de" ? "Ein kurzer Entwurf ueber Mars." : "A short draft about Mars.",
                                        title: locale === "de" ? "Mars im Ueberblick" : "Mars Overview",
                                    },
                                ])
                            ),
                            ...(activeLocale ? { locale: activeLocale } : {}),
                        }
                      : {
                            action: "create",
                            collection: "posts",
                            data: {
                                content: "Mars is the fourth planet from the Sun.",
                                excerpt: "A short draft about Mars.",
                                status: "draft",
                                title: "Mars Overview",
                            },
                            label: proposalLabel,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                        }
              )
            : null

    const responseText = proposal ? "Prepared one draft post proposal." : "No content change was proposed."

    const debugPayload = createDebugPayload({
        debug: {
            model: "e2e-model",
            provider: "openai",
            tools: [],
        },
        proposalCount: proposal ? 1 : 0,
        selectedLocales,
        toolFailures: [],
        usage: {
            inputTokens: 42,
            outputTokens: 27,
            totalTokens: 69,
        },
        writeIntent: wantsCreatePost,
    })

    return new Response(
        createSSEEventStream([
            {
                data: {
                    delta: responseText,
                },
                event: "text",
            },
            {
                data: {
                    proposals: proposal ? [proposal] : [],
                    usage: {
                        inputTokens: 42,
                        outputTokens: 27,
                        totalTokens: 69,
                    },
                },
                event: "proposals",
            },
            {
                data: debugPayload,
                event: "debug",
            },
            {
                data: {},
                event: "done",
            },
        ]),
        {
            headers: {
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8",
            },
        }
    )
}

const getRequiredFieldInfos = (fields: FieldConfig[], titleFieldName?: string, path = ""): RequiredFieldInfo[] => {
    return fields.flatMap((field) => {
        const fieldPath = field.name ? (path ? `${path}.${field.name}` : field.name) : path
        const requiredField =
            field.required && fieldPath
                ? [
                      {
                          defaultValue: field.defaultValue,
                          isTitleField: field.name === titleFieldName,
                          localized: Boolean(field.localized),
                          options: field.options,
                          path: fieldPath,
                          type: field.type,
                      },
                  ]
                : []
        const nestedFields = field.fields?.length ? getRequiredFieldInfos(field.fields, titleFieldName, fieldPath) : []
        const nestedBlocks = field.blocks?.length
            ? field.blocks.flatMap((block) => getRequiredFieldInfos(block.fields || [], titleFieldName, `${fieldPath}.${block.slug}`))
            : []

        return [...requiredField, ...nestedFields, ...nestedBlocks]
    })
}

const getCreateFallbackValue = ({ field, label }: { field: RequiredFieldInfo; label: string }) => {
    if (field.defaultValue !== undefined) return field.defaultValue
    if (field.path === "_status") return "draft"
    if (field.type === "checkbox") return false
    if (field.type === "select" || field.type === "radio") {
        return getOptionValue(field.options?.[0])
    }

    const terminalSegment = field.path.split(".").at(-1)?.toLowerCase()

    if ((field.isTitleField || ["title", "name", "label", "headline"].includes(terminalSegment || "")) && ["text", "textarea"].includes(field.type || "")) {
        return getSafeProposalLabel(label)
    }

    return undefined
}

const fillMissingCreateFields = ({
    data,
    label,
    localizedData,
    requiredFields,
}: {
    data?: Record<string, unknown>
    label: string
    localizedData?: LocalizedDataInput
    requiredFields: RequiredFieldInfo[]
}) => {
    if (localizedData) {
        const completedLocalizedData = Object.fromEntries(Object.entries(localizedData).map(([locale, localeData]) => [locale, { ...localeData }]))
        const localeEntries = Object.entries(completedLocalizedData)
        const [firstLocale, firstLocaleData] = localeEntries[0] || []

        for (const [locale, localeData] of localeEntries) {
            for (const field of requiredFields.filter((item) => item.localized)) {
                if (hasValueAtPath(localeData, field.path)) continue

                const fallbackValue = getCreateFallbackValue({ field, label })

                if (fallbackValue !== undefined) {
                    setValueAtPath(localeData, field.path, fallbackValue)
                }
            }
        }

        if (firstLocale && firstLocaleData) {
            for (const field of requiredFields.filter((item) => !item.localized)) {
                if (hasValueAtPath(firstLocaleData, field.path)) continue

                const fallbackValue = getCreateFallbackValue({ field, label })

                if (fallbackValue !== undefined) {
                    setValueAtPath(firstLocaleData, field.path, fallbackValue)
                }
            }
        }

        return {
            localizedData: completedLocalizedData,
        }
    }

    const completedData = { ...(data || {}) }

    for (const field of requiredFields) {
        if (hasValueAtPath(completedData, field.path)) continue

        const fallbackValue = getCreateFallbackValue({ field, label })

        if (fallbackValue !== undefined) {
            setValueAtPath(completedData, field.path, fallbackValue)
        }
    }

    return {
        data: completedData,
    }
}

const getMissingCreateFields = ({
    data,
    localizedData,
    requiredFields,
}: {
    data?: Record<string, unknown>
    localizedData?: LocalizedDataInput
    requiredFields: RequiredFieldInfo[]
}) => {
    if (localizedData) {
        const locales = Object.entries(localizedData)
        const firstLocale = locales[0]

        if (!firstLocale) {
            return ["localizedData must include at least one locale entry"]
        }

        const missing: string[] = []
        const localizedRequiredFields: typeof requiredFields = []
        const sharedRequiredFields: typeof requiredFields = []

        for (const field of requiredFields) {
            if (field.localized) {
                localizedRequiredFields.push(field)
            } else {
                sharedRequiredFields.push(field)
            }
        }

        for (const [locale, localeData] of locales) {
            for (const field of localizedRequiredFields) {
                if (!hasValueAtPath(localeData, field.path)) {
                    missing.push(`${locale}:${field.path}`)
                }
            }
        }

        for (const field of sharedRequiredFields) {
            if (!hasValueAtPath(firstLocale[1], field.path)) {
                missing.push(`${firstLocale[0]}:${field.path}`)
            }
        }

        return missing
    }

    if (!data) return ["data is required"]

    return requiredFields.flatMap((field) => (hasValueAtPath(data, field.path) ? [] : [field.path]))
}

const getProposalSummary = (proposal: ActionProposal) => ({
    action: proposal.action,
    collection: "collection" in proposal ? proposal.collection : undefined,
    hasData: "data" in proposal && Boolean(proposal.data),
    hasLocalizedData: "localizedData" in proposal && Boolean(proposal.localizedData),
    id: "id" in proposal ? proposal.id : undefined,
    label: proposal.label,
    locale: proposal.locale,
    locales: "localizedData" in proposal && proposal.localizedData ? Object.keys(proposal.localizedData) : undefined,
    slug: "slug" in proposal ? proposal.slug : undefined,
})

const getCollectionBlockTypes = (fields: readonly BlockFieldConfig[]): string[] => {
    const blockTypes = new Set<string>()

    const visitFields = (items: readonly BlockFieldConfig[]) => {
        for (const field of items) {
            if (field.type === "blocks" && field.blocks) {
                for (const block of field.blocks) {
                    blockTypes.add(block.slug)
                    if (block.fields?.length) {
                        visitFields(block.fields as BlockFieldConfig[])
                    }
                }
            }

            if (field.fields?.length) {
                visitFields(field.fields as BlockFieldConfig[])
            }
        }
    }

    visitFields(fields)

    return [...blockTypes]
}

const regexSpecialCharactersPattern = /[.*+?^${}()|[\]\\]/g

const getRequestedBlockTypes = ({ availableBlockTypes, mentions, prompt }: { availableBlockTypes: string[]; mentions?: ChatMention[]; prompt: string }) => {
    const requestedBlockTypes = new Set<string>()
    const normalizedPrompt = prompt.toLowerCase()
    const availableBlockTypeSet = new Set(availableBlockTypes)
    const blockTypesByNormalizedSlug = new Map(availableBlockTypes.map((blockType) => [blockType.toLowerCase(), blockType]))
    const escapedBlockTypes = availableBlockTypes.map((blockType) => blockType.replace(regexSpecialCharactersPattern, "\\$&")).join("|")
    const blockPattern = escapedBlockTypes ? new RegExp(`\\b(${escapedBlockTypes})\\b(?:\\s+block)?`, "gi") : null

    for (const mention of mentions || []) {
        if (mention.type === "block" && mention.slug && availableBlockTypeSet.has(mention.slug)) {
            requestedBlockTypes.add(mention.slug)
        }
    }

    if (blockPattern) {
        for (const match of normalizedPrompt.matchAll(blockPattern)) {
            const blockType = match[1] ? blockTypesByNormalizedSlug.get(match[1].toLowerCase()) : null

            if (blockType) {
                requestedBlockTypes.add(blockType)
            }
        }
    }

    return [...requestedBlockTypes]
}

const collectProposalBlockTypes = ({ data, fields }: { data: Record<string, unknown>; fields: readonly BlockFieldConfig[] }): Set<string> => {
    const foundBlockTypes = new Set<string>()

    const visitFields = (items: readonly BlockFieldConfig[], value: Record<string, unknown>) => {
        for (const field of items) {
            if (!field.name) continue

            const fieldValue = value[field.name]
            if (fieldValue === undefined || fieldValue === null) continue

            if (field.type === "blocks" && Array.isArray(fieldValue)) {
                const blocksBySlug = new Map(field.blocks?.map((block) => [block.slug, block]))

                for (const blockItem of fieldValue) {
                    if (!isRecord(blockItem)) continue

                    const blockType =
                        typeof blockItem.blockType === "string"
                            ? blockItem.blockType
                            : typeof blockItem.type === "string"
                              ? blockItem.type
                              : typeof blockItem.slug === "string"
                                ? blockItem.slug
                                : null

                    if (blockType) {
                        foundBlockTypes.add(blockType)
                    }

                    if (blockType) {
                        const blockConfig = blocksBySlug.get(blockType)
                        if (blockConfig?.fields?.length) {
                            visitFields(blockConfig.fields as BlockFieldConfig[], blockItem)
                        }
                    }
                }

                continue
            }

            if (field.type === "group" && isRecord(fieldValue) && field.fields?.length) {
                visitFields(field.fields as BlockFieldConfig[], fieldValue)
                continue
            }

            if (field.type === "array" && Array.isArray(fieldValue) && field.fields?.length) {
                for (const item of fieldValue) {
                    if (isRecord(item)) {
                        visitFields(field.fields as BlockFieldConfig[], item)
                    }
                }
            }
        }
    }

    visitFields(fields, data)

    return foundBlockTypes
}

const collectRelationshipTargets = ({
    data,
    fields,
    path = "",
}: {
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
    path?: string
}): RelationshipTargetReference[] => {
    const targets: RelationshipTargetReference[] = []

    for (const field of fields) {
        if (!field.name) continue

        const fieldPath = path ? `${path}.${field.name}` : field.name
        const fieldValue = data[field.name]

        if (fieldValue === undefined || fieldValue === null) continue

        if (field.type === "relationship" || field.type === "upload") {
            const relationTargets = Array.isArray(field.relationTo)
                ? field.relationTo.filter((item): item is string => typeof item === "string")
                : typeof field.relationTo === "string"
                  ? [field.relationTo]
                  : []

            const collectSingle = (value: unknown, itemPath: string) => {
                if (typeof value === "string" || typeof value === "number") {
                    if (relationTargets.length === 1) {
                        targets.push({
                            collection: relationTargets[0],
                            id: value,
                            path: itemPath,
                        })
                    }

                    return
                }

                if (!isRecord(value)) return

                const relationTo = typeof value.relationTo === "string" ? value.relationTo : relationTargets[0]
                const id =
                    typeof value.id === "string" || typeof value.id === "number"
                        ? value.id
                        : typeof value.value === "string" || typeof value.value === "number"
                          ? value.value
                          : undefined

                if (!relationTo || id === undefined) return

                targets.push({
                    collection: relationTo,
                    id,
                    path: itemPath,
                })
            }

            if (field.hasMany && Array.isArray(fieldValue)) {
                fieldValue.forEach((item, index) => collectSingle(item, `${fieldPath}.${index}`))
            } else {
                collectSingle(fieldValue, fieldPath)
            }

            continue
        }

        if (field.type === "group" && isRecord(fieldValue) && field.fields?.length) {
            targets.push(
                ...collectRelationshipTargets({
                    data: fieldValue,
                    fields: field.fields as BlockFieldConfig[],
                    path: fieldPath,
                })
            )
            continue
        }

        if (field.type === "array" && Array.isArray(fieldValue) && field.fields?.length) {
            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                targets.push(
                    ...collectRelationshipTargets({
                        data: item,
                        fields: field.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
            continue
        }

        if (field.type === "blocks" && Array.isArray(fieldValue) && field.blocks?.length) {
            const blocksBySlug = new Map(field.blocks.map((block) => [block.slug, block]))

            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                const blockType =
                    typeof item.blockType === "string"
                        ? item.blockType
                        : typeof item.type === "string"
                          ? item.type
                          : typeof item.slug === "string"
                            ? item.slug
                            : null

                if (!blockType) return

                const blockConfig = blocksBySlug.get(blockType)
                if (!blockConfig?.fields?.length) return

                targets.push(
                    ...collectRelationshipTargets({
                        data: item,
                        fields: blockConfig.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
        }
    }

    return targets
}

const collectUploadTargets = ({
    data,
    fields,
    path = "",
}: {
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
    path?: string
}): RelationshipTargetReference[] => {
    const targets: RelationshipTargetReference[] = []

    for (const field of fields) {
        if (!field.name) continue

        const fieldPath = path ? `${path}.${field.name}` : field.name
        const fieldValue = data[field.name]

        if (fieldValue === undefined || fieldValue === null) continue

        if (field.type === "upload") {
            const relationTargets = Array.isArray(field.relationTo)
                ? field.relationTo.filter((item): item is string => typeof item === "string")
                : typeof field.relationTo === "string"
                  ? [field.relationTo]
                  : []

            const collectSingle = (value: unknown, itemPath: string) => {
                if (typeof value === "string" || typeof value === "number") {
                    if (relationTargets.length === 1) {
                        targets.push({
                            collection: relationTargets[0],
                            id: value,
                            path: itemPath,
                        })
                    }

                    return
                }

                if (!isRecord(value)) return

                const relationTo = typeof value.relationTo === "string" ? value.relationTo : relationTargets[0]
                const id =
                    typeof value.id === "string" || typeof value.id === "number"
                        ? value.id
                        : typeof value.value === "string" || typeof value.value === "number"
                          ? value.value
                          : undefined

                if (!relationTo || id === undefined) return

                targets.push({
                    collection: relationTo,
                    id,
                    path: itemPath,
                })
            }

            if (field.hasMany && Array.isArray(fieldValue)) {
                fieldValue.forEach((item, index) => collectSingle(item, `${fieldPath}.${index}`))
            } else {
                collectSingle(fieldValue, fieldPath)
            }

            continue
        }

        if (field.type === "group" && isRecord(fieldValue) && field.fields?.length) {
            targets.push(
                ...collectUploadTargets({
                    data: fieldValue,
                    fields: field.fields as BlockFieldConfig[],
                    path: fieldPath,
                })
            )
            continue
        }

        if (field.type === "array" && Array.isArray(fieldValue) && field.fields?.length) {
            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                targets.push(
                    ...collectUploadTargets({
                        data: item,
                        fields: field.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
            continue
        }

        if (field.type === "blocks" && Array.isArray(fieldValue) && field.blocks?.length) {
            const blocksBySlug = new Map(field.blocks.map((block) => [block.slug, block]))

            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                const blockType =
                    typeof item.blockType === "string"
                        ? item.blockType
                        : typeof item.type === "string"
                          ? item.type
                          : typeof item.slug === "string"
                            ? item.slug
                            : null

                if (!blockType) return

                const blockConfig = blocksBySlug.get(blockType)
                if (!blockConfig?.fields?.length) return

                targets.push(
                    ...collectUploadTargets({
                        data: item,
                        fields: blockConfig.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
        }
    }

    return targets
}

const validateRelationshipTargetsExist = async ({
    data,
    fields,
    req,
}: {
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
    req: Parameters<PayloadHandler>[0]
}) => {
    const targets = collectRelationshipTargets({
        data,
        fields,
    })

    const targetResults = await Promise.all(
        targets.map(async (target) => {
            try {
                await req.payload.findByID({
                    collection: target.collection as never,
                    depth: 0,
                    id: String(target.id),
                    overrideAccess: false,
                    req,
                })
                return null
            } catch {
                return target
            }
        })
    )

    return targetResults.filter((target): target is RelationshipTargetReference => Boolean(target))
}

const getUploadTargetsOutsideAttachments = ({
    allowedAttachmentKeys,
    data,
    fields,
}: {
    allowedAttachmentKeys: Set<string>
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
}) => {
    if (allowedAttachmentKeys.size === 0) return []

    return collectUploadTargets({
        data,
        fields,
    }).filter((target) => !allowedAttachmentKeys.has(`${target.collection}:${String(target.id)}`))
}

const getMentionSummary = (mentions?: ChatMention[]) =>
    mentions?.map((mention) => ({
        collection: "collection" in mention ? mention.collection : undefined,
        id: "id" in mention ? mention.id : undefined,
        slug: mention.slug,
        type: mention.type,
    })) || []

const getMediaAttachmentContext = async ({
    allowedCollectionsBySlug,
    attachments,
    collections,
    req,
}: {
    allowedCollectionsBySlug: Map<string, Parameters<PayloadHandler>[0]["payload"]["config"]["collections"][number]>
    attachments?: ChatMediaAttachment[]
    collections?: ResolvedCollectionPermissionMap
    req: Parameters<PayloadHandler>[0]
}) => {
    if (!attachments?.length) return []

    const contexts: Record<string, unknown>[] = []
    const seen = new Set<string>()

    for (const attachment of attachments.slice(0, 8)) {
        if (attachment.type !== "media" || !attachment.collection || !attachment.id) continue

        const key = `${attachment.collection}:${attachment.id}`
        if (seen.has(key)) continue

        const collectionConfig = allowedCollectionsBySlug.get(attachment.collection)
        if (!collectionConfig?.upload) continue

        const doc = await req.payload
            .findByID({
                collection: attachment.collection as never,
                depth: 1,
                id: attachment.id,
                overrideAccess: false,
                req,
            })
            .catch(() => null)

        if (!doc) continue

        seen.add(key)
        contexts.push({
            attachment,
            collection: attachment.collection,
            doc,
            schema: describeCollectionLikeConfig({
                config: collectionConfig as never,
                permissions: collections,
                type: "collection",
            }),
            type: "mediaAttachment",
        })
    }

    return contexts
}

const formatProposalIssuesForRetry = (issues: ProposalValidationIssue[]) => {
    return issues
        .slice(0, 6)
        .map((issue) => {
            switch (issue.code) {
                case "invalid_block_type":
                    return `${issue.path}: use an exact blockType from the schema`
                case "invalid_blocks":
                    return `${issue.path}: blocks fields must be arrays of objects with blockType and exact field names`
                case "invalid_array":
                    return `${issue.path}: array fields must be arrays of complete objects`
                case "missing_required_field":
                    return `${issue.path}: required field missing`
                case "unknown_field":
                    return `${issue.path}: unknown field, use exact schema field names only`
                case "invalid_relationship":
                    return `${issue.path}: use relationship IDs or { relationTo, value }, not free text`
                default:
                    return `${issue.path}: ${issue.message}`
            }
        })
        .join("; ")
}

const createCollectionAliasMap = (collections: Array<{ labels?: { plural?: unknown; singular?: unknown }; slug: string }>) => {
    const aliasMap = new Map<string, string>()

    const addAlias = (alias: string | undefined, slug: string) => {
        const normalizedAlias = alias?.trim().toLowerCase()
        if (!normalizedAlias) return
        if (!aliasMap.has(normalizedAlias)) {
            aliasMap.set(normalizedAlias, slug)
        }
    }

    for (const collection of collections) {
        addAlias(collection.slug, collection.slug)
        addAlias(collection.slug.replace(/-/g, " "), collection.slug)

        const singular = typeof collection.labels?.singular === "string" ? collection.labels.singular : undefined
        const plural = typeof collection.labels?.plural === "string" ? collection.labels.plural : undefined

        addAlias(singular, collection.slug)
        addAlias(plural, collection.slug)

        if (singular?.endsWith("s")) {
            addAlias(singular.slice(0, -1), collection.slug)
        }

        if (plural?.endsWith("s")) {
            addAlias(plural.slice(0, -1), collection.slug)
        }
    }

    return Object.fromEntries(aliasMap.entries())
}

const getLikelyCollectionMatches = ({ aliasMap, prompt }: { aliasMap: Record<string, string>; prompt: string }) => {
    const normalizedPrompt = prompt.toLowerCase()
    const matches = new Set<string>()
    const aliases = Object.keys(aliasMap).sort((a, b) => b.length - a.length)
    const aliasPattern = aliases.length > 0 ? new RegExp(aliases.map((alias) => alias.replace(regexSpecialCharactersPattern, "\\$&")).join("|"), "g") : null

    if (!aliasPattern) return []

    for (const match of normalizedPrompt.matchAll(aliasPattern)) {
        const alias = match[0]
        const slug = aliasMap[alias]

        if (slug) {
            matches.add(slug)
        }
    }

    return [...matches]
}

const hasWriteIntent = (prompt: string) => {
    const normalizedPrompt = prompt.toLowerCase()
    return /\b(create|build|generate|write|draft|make|add|update|edit|change|revise|refine|rewrite|translate|delete|remove)\b/.test(normalizedPrompt)
}

const getIntentToolChoice = (prompt: string): ToolChoice | undefined => {
    const normalizedPrompt = prompt.toLowerCase()

    if (/\b(delete|remove)\b/.test(normalizedPrompt)) {
        return {
            toolName: "proposeDeleteDoc",
            type: "tool",
        }
    }

    // Update existing document (add block, modify content, etc.)
    if (/\b(update|edit|change|modify|einfügen|hinzufügen|addieren)\b/.test(normalizedPrompt)) {
        return {
            toolName: "proposeUpdateDoc",
            type: "tool",
        }
    }

    // Create a new document
    if (/\b(create|build|generate|write|draft|make|add|füge|einfügen|hinzufügen|addieren)\b/.test(normalizedPrompt)) {
        return {
            toolName: "proposeCreateDoc",
            type: "tool",
        }
    }

    return undefined
}

export const createChatHandler =
    (options: ChatOptions = {}): PayloadHandler =>
    async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

        const body = req.json ? ((await req.json().catch(() => null)) as ChatBody | null) : null

        const prompt = body?.prompt?.trim()
        if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 })

        const selectedLocales: string[] = []
        const selectedLocaleSet = new Set<string>()
        for (const mention of body?.mentions || []) {
            if (mention.type !== "locale" || !mention.slug || selectedLocaleSet.has(mention.slug)) continue

            selectedLocaleSet.add(mention.slug)
            selectedLocales.push(mention.slug)
        }
        const activeLocale = selectedLocales.at(-1)
        const mentionSummary = getMentionSummary(body?.mentions)

        if (e2eModeEnabled()) {
            return createE2EChatResponse({
                prompt,
                selectedLocales,
            })
        }

        const user = req.user as User
        const requestedProvider = body?.provider || user.aiProvider || "openai"

        if (!isAIProvider(requestedProvider)) return Response.json({ error: `Unsupported AI provider: ${requestedProvider}` }, { status: 400 })

        const provider = requestedProvider
        const userApiKey = options.allowUserApiKeys === false ? null : user.aiApiKey
        const providerConfig = getProviderConfig({
            apiKey: userApiKey,
            defaultModels: options.models?.defaults,
            model: body?.model,
            provider,
        })
        const debug: ChatDebug = {
            model: providerConfig.modelID,
            provider,
            tools: [
                "getDoc",
                "getGlobal",
                "listCollections",
                "listGlobals",
                "proposeCreateDoc",
                "proposeDeleteDoc",
                "proposeUpdateDoc",
                "proposeUpdateGlobal",
                "searchDocs",
            ],
        }

        logHandlerEvent(req, "info", {
            activeLocale,
            debug,
            mentionCount: mentionSummary.length,
            mentions: mentionSummary,
            msg: "AI chat started",
            promptPreview: getLogPreview(prompt),
            selectedLocales,
        })

        if (!providerConfig.apiKey) {
            logHandlerEvent(req, "warn", {
                activeLocale,
                debug,
                msg: "AI chat blocked: missing provider API key",
                promptPreview: getLogPreview(prompt),
                selectedLocales,
            })
            return Response.json(
                {
                    error:
                        options.allowUserApiKeys === false
                            ? `Configure a ${provider} API key in the server environment first.`
                            : `Add a ${provider} API key to your account settings or configure it in the server environment first.`,
                },
                { status: 400 }
            )
        }

        try {
            const proposals: ActionProposal[] = []
            const toolFailures: ToolFailure[] = []
            const registerToolFailure = (failure: ToolFailure) => {
                toolFailures.push(failure)
                logHandlerEvent(req, "warn", {
                    debug,
                    ...failure,
                    msg: "AI tool validation failed",
                    promptPreview: getLogPreview(prompt),
                })
            }
            const createToolError = ({ collection, details, message, slug, tool }: ToolFailure) => {
                registerToolFailure({
                    collection,
                    details,
                    message,
                    slug,
                    tool,
                })

                return {
                    error: message,
                }
            }
            const addSignedProposal = <Proposal extends ActionProposal>(proposal: Proposal) => {
                if ("data" in proposal && proposal.data && containsSensitiveData(proposal.data)) {
                    return createToolError({
                        details: getProposalSummary(proposal),
                        message: "Proposal contains sensitive fields and cannot be created.",
                        tool: `propose${proposal.action[0]?.toUpperCase()}${proposal.action.slice(1)}`,
                    })
                }

                if (
                    "localizedData" in proposal &&
                    hasLocalizedData(proposal.localizedData) &&
                    Object.values(proposal.localizedData).some((value) => containsSensitiveData(value))
                ) {
                    return createToolError({
                        details: getProposalSummary(proposal),
                        message: "Proposal contains sensitive fields and cannot be created.",
                        tool: `propose${proposal.action[0]?.toUpperCase()}${proposal.action.slice(1)}`,
                    })
                }

                const signedProposal = signAIActionProposal(proposal)

                proposals.push(signedProposal)
                logHandlerEvent(req, "info", {
                    debug,
                    msg: "AI proposal created",
                    proposal: getProposalSummary(signedProposal),
                })
                return signedProposal
            }
            const collectionSlugs = getAllowedCollectionSlugs(req, options.collections)
            const collectionSlugSet = new Set(collectionSlugs)
            const globalConfigs = req.payload.config.globals || []
            const globalSlugs = globalConfigs.map((global) => global.slug)
            const globalConfigsBySlug = new Map(globalConfigs.map((global) => [global.slug, global]))
            const allowedCollections = req.payload.config.collections.filter((collection) => collectionSlugSet.has(collection.slug))
            const allowedCollectionsBySlug = new Map(allowedCollections.map((collection) => [collection.slug, collection]))

            if (collectionSlugs.length === 0) {
                logHandlerEvent(req, "warn", {
                    debug,
                    msg: "AI chat blocked: no AI-enabled collections configured",
                })
                return Response.json({ error: "No AI-enabled collections are configured." }, { status: 400 })
            }

            const blockContexts = [
                ...allowedCollections.flatMap((collection) =>
                    collectBlocks({
                        fields: collection.fields as FieldConfig[],
                        parent: collection.slug,
                    })
                ),
                ...globalConfigs.flatMap((global) =>
                    collectBlocks({
                        fields: global.fields as FieldConfig[],
                        parent: global.slug,
                    })
                ),
            ]
            const mentionContext = await getMentionContext({
                blockContexts,
                collectionSlugs,
                collections: options.collections,
                globalSlugs,
                mentions: body?.mentions,
                req,
            })
            const mediaAttachmentContext = await getMediaAttachmentContext({
                allowedCollectionsBySlug,
                attachments: body?.attachments,
                collections: options.collections,
                req,
            })
            const allowedAttachmentKeys = new Set(
                mediaAttachmentContext.flatMap((context) => {
                    const attachment = context.attachment

                    return isRecord(attachment) && typeof attachment.collection === "string" && typeof attachment.id === "string"
                        ? [`${attachment.collection}:${attachment.id}`]
                        : []
                })
            )

            mentionContext.push(...mediaAttachmentContext)
            const mentionedCollectionSlugs: string[] = []
            const mentionedCollectionSlugSet = new Set<string>()
            for (const mention of body?.mentions || []) {
                const slug =
                    mention.type === "collection" && mention.slug ? mention.slug : mention.type === "doc" && mention.collection ? mention.collection : null

                if (!slug || !collectionSlugSet.has(slug) || mentionedCollectionSlugSet.has(slug)) continue

                mentionedCollectionSlugSet.add(slug)
                mentionedCollectionSlugs.push(slug)
            }
            const createRequiredFieldsByCollection = Object.fromEntries(
                allowedCollections.map((collection) => [
                    collection.slug,
                    getRequiredFieldInfos(collection.fields as FieldConfig[], collection.admin?.useAsTitle),
                ])
            )
            const titleFieldByCollection = Object.fromEntries(
                allowedCollections.flatMap((collection) => (collection.admin?.useAsTitle ? [[collection.slug, collection.admin.useAsTitle]] : []))
            )
            const focusedRequiredFieldsByCollection = Object.fromEntries(
                mentionedCollectionSlugs.map((slug) => [slug, createRequiredFieldsByCollection[slug] || []])
            )
            const focusedTitleFieldByCollection = Object.fromEntries(
                mentionedCollectionSlugs.flatMap((slug) => (titleFieldByCollection[slug] ? [[slug, titleFieldByCollection[slug]]] : []))
            )
            const collectionAliasMap = createCollectionAliasMap(allowedCollections)
            const likelyCollectionMatches = getLikelyCollectionMatches({
                aliasMap: collectionAliasMap,
                prompt,
            })
            const writeIntent = hasWriteIntent(prompt)
            const inferredCollectionSlug =
                mentionedCollectionSlugs.length === 1
                    ? mentionedCollectionSlugs[0]
                    : mentionedCollectionSlugs.length === 0 && likelyCollectionMatches.length === 1
                      ? likelyCollectionMatches[0]
                      : undefined
            const inferredCollectionConfig = inferredCollectionSlug ? allowedCollectionsBySlug.get(inferredCollectionSlug) : undefined
            if (inferredCollectionConfig && !mentionContext.some((item) => item.type === "collection" && item.slug === inferredCollectionConfig.slug)) {
                mentionContext.push({
                    ...describeCollectionLikeConfig({
                        config: inferredCollectionConfig as never,
                        permissions: options.collections,
                        type: "collection",
                    }),
                    inferredFromPrompt: true,
                })
            }
            const intentToolChoice = inferredCollectionConfig ? getIntentToolChoice(prompt) : undefined
            logHandlerEvent(req, "info", {
                activeLocale,
                allowedCollectionCount: allowedCollections.length,
                collectionSlugs,
                focusedCollections: mentionedCollectionSlugs,
                globalSlugs,
                inferredCollectionSlug,
                intentToolChoice,
                likelyCollectionMatches,
                msg: "AI chat context prepared",
                selectedLocales,
                writeIntent,
            })
            const collectionSlugSchema = z.enum(collectionSlugs as [string, ...string[]])
            const getDisallowedCollectionActionError = (collection: string, action: CollectionAction) => {
                if (
                    isCollectionActionAllowed({
                        action,
                        permissions: options.collections,
                        req,
                        slug: collection,
                    })
                )
                    return null

                return createToolError({
                    collection,
                    message: `${action} is not enabled for collection: ${collection}`,
                    tool: "collectionPermissionCheck",
                })
            }
            const tools = {
                getDoc: {
                    description: "Read a document by collection and id.",
                    inputSchema: z.object({
                        collection: collectionSlugSchema,
                        id: z.string().min(1),
                    }),
                    execute: async ({ collection, id }: CollectionInput & DocIDInput) => {
                        return req.payload.findByID({
                            collection: collection as never,
                            depth: 2,
                            id,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                            overrideAccess: false,
                            req,
                        })
                    },
                },
                listCollections: {
                    description: "List collections; pass slug for one full schema.",
                    inputSchema: z.object({
                        slug: collectionSlugSchema.optional(),
                    }),
                    execute: async ({ slug }: OptionalSlugInput) => {
                        if (slug) {
                            const collection = allowedCollectionsBySlug.get(slug)
                            if (!collection) {
                                return createToolError({
                                    message: `Unknown collection: ${slug}`,
                                    slug,
                                    tool: "listCollections",
                                })
                            }

                            return describeCollectionLikeConfig({
                                config: collection as never,
                                permissions: options.collections,
                                type: "collection",
                            })
                        }

                        return allowedCollections.map((collection) =>
                            describeCollectionLikeSummary({
                                config: collection as never,
                                permissions: options.collections,
                                type: "collection",
                            })
                        )
                    },
                },
                getGlobal: {
                    description: "Read a global by slug.",
                    inputSchema: z.object({
                        slug: z.string().min(1),
                    }),
                    execute: async ({ slug }: SlugInput) => {
                        const globalConfig = globalConfigsBySlug.get(slug)
                        if (!globalConfig) {
                            return createToolError({
                                message: `Unknown global: ${slug}`,
                                slug,
                                tool: "getGlobal",
                            })
                        }

                        return req.payload.findGlobal({
                            depth: 2,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                            overrideAccess: false,
                            req,
                            slug: slug as never,
                        })
                    },
                },
                listGlobals: {
                    description: "List globals; pass slug for one full schema.",
                    inputSchema: z.object({
                        slug: z.string().optional(),
                    }),
                    execute: async ({ slug }: OptionalSlugInput) => {
                        if (slug) {
                            const global = globalConfigsBySlug.get(slug)
                            if (!global) {
                                return createToolError({
                                    message: `Unknown global: ${slug}`,
                                    slug,
                                    tool: "listGlobals",
                                })
                            }

                            return describeCollectionLikeConfig({
                                config: global as never,
                                type: "global",
                            })
                        }

                        return globalConfigs.map((global) =>
                            describeCollectionLikeSummary({
                                config: global as never,
                                type: "global",
                            })
                        )
                    },
                },
                proposeCreateDoc: {
                    description:
                        "Propose document creation. Use exact schema fields; include required fields. Use localizedData for multi-locale writes.",
                    inputSchema: z
                        .object({
                            collection: collectionSlugSchema,
                            data: z.record(z.string(), z.unknown()).optional(),
                            label: z.string().min(1),
                            localizedData: nonEmptyLocalizedDataSchema.optional(),
                        })
                        .refine((value) => Boolean(value.data || value.localizedData), {
                            message: "Either data or localizedData is required.",
                        }),
                    execute: async ({
                        collection,
                        data,
                        label,
                        localizedData,
                    }: CollectionInput & Partial<DataInput> & LabelInput & { localizedData?: LocalizedDataInput }) => {
                        const permissionError = getDisallowedCollectionActionError(collection, "create")
                        if (permissionError) return permissionError
                        const collectionConfig = allowedCollectionsBySlug.get(collection)
                        const collectionFields = (collectionConfig?.fields || []) as BlockFieldConfig[]
                        const preparedData = prepareProposalWriteData({
                            collectionConfig: collectionConfig as ProposalCollectionConfig | undefined,
                            data,
                            inferenceText: prompt,
                            label,
                            localizedData,
                            mode: "create",
                        })

                        if (preparedData.issues.length > 0) {
                            const titleFieldName = titleFieldByCollection[collection]
                            const missingTitleField = titleFieldName
                                ? preparedData.issues.some((issue) => issue.path === titleFieldName || issue.path.endsWith(`.${titleFieldName}`))
                                : false

                            return createToolError({
                                collection,
                                details: {
                                    issues: preparedData.issues,
                                    titleFieldName,
                                },
                                message: missingTitleField
                                    ? `Create proposal is missing the required title field "${titleFieldName}" for ${collection}. Infer a concise title from the user request and retry.`
                                    : `Create proposal for ${collection} is invalid. Retry with exact schema fields and complete array/block objects: ${formatProposalIssuesForRetry(preparedData.issues)}`,
                                tool: "proposeCreateDoc",
                            })
                        }

                        const requestedBlockTypes = getRequestedBlockTypes({
                            availableBlockTypes: getCollectionBlockTypes(collectionFields),
                            mentions: body?.mentions,
                            prompt,
                        })

                        if (requestedBlockTypes.length > 0) {
                            const proposalBlockTypes = new Set<string>()

                            if (preparedData.data) {
                                for (const blockType of collectProposalBlockTypes({
                                    data: preparedData.data,
                                    fields: collectionFields,
                                })) {
                                    proposalBlockTypes.add(blockType)
                                }
                            }

                            if (preparedData.localizedData) {
                                for (const localeData of Object.values(preparedData.localizedData)) {
                                    for (const blockType of collectProposalBlockTypes({
                                        data: localeData,
                                        fields: collectionFields,
                                    })) {
                                        proposalBlockTypes.add(blockType)
                                    }
                                }
                            }

                            const missingBlockTypes = requestedBlockTypes.filter((blockType) => !proposalBlockTypes.has(blockType))

                            if (missingBlockTypes.length > 0) {
                                return createToolError({
                                    collection,
                                    details: {
                                        missingBlockTypes,
                                        requestedBlockTypes,
                                    },
                                    message: `Create proposal for ${collection} is missing required block types from the request: ${missingBlockTypes.join(", ")}. Add them to the appropriate blocks field using exact blockType values and complete required fields.`,
                                    tool: "proposeCreateDoc",
                                })
                            }
                        }

                        const uploadTargetsOutsideAttachments = [
                            ...(preparedData.data
                                ? getUploadTargetsOutsideAttachments({
                                      allowedAttachmentKeys,
                                      data: preparedData.data,
                                      fields: collectionFields,
                                  })
                                : []),
                            ...(preparedData.localizedData
                                ? Object.values(preparedData.localizedData).flatMap((localeData) =>
                                      getUploadTargetsOutsideAttachments({
                                          allowedAttachmentKeys,
                                          data: localeData,
                                          fields: collectionFields,
                                      })
                                  )
                                : []),
                        ]

                        if (uploadTargetsOutsideAttachments.length > 0) {
                            return createToolError({
                                collection,
                                details: {
                                    allowedAttachments: [...allowedAttachmentKeys],
                                    uploadTargetsOutsideAttachments,
                                },
                                message: `Create proposal for ${collection} uses upload references that are not in the uploaded attachments: ${uploadTargetsOutsideAttachments.map((target) => `${target.path} -> ${target.collection}:${target.id}`).join(", ")}. Use only uploaded media attachment IDs for upload fields.`,
                                tool: "proposeCreateDoc",
                            })
                        }

                        const invalidRelationshipTargets = [
                            ...(preparedData.data
                                ? await validateRelationshipTargetsExist({
                                      data: preparedData.data,
                                      fields: collectionFields,
                                      req,
                                  })
                                : []),
                            ...(preparedData.localizedData
                                ? (
                                      await Promise.all(
                                          Object.values(preparedData.localizedData).map((localeData) =>
                                              validateRelationshipTargetsExist({
                                                  data: localeData,
                                                  fields: collectionFields,
                                                  req,
                                              })
                                          )
                                      )
                                  ).flat()
                                : []),
                        ]

                        if (invalidRelationshipTargets.length > 0) {
                            return createToolError({
                                collection,
                                details: {
                                    invalidRelationshipTargets,
                                },
                                message: `Create proposal for ${collection} contains relationship or upload references that do not exist: ${invalidRelationshipTargets.map((target) => `${target.path} -> ${target.collection}:${target.id}`).join(", ")}.`,
                                tool: "proposeCreateDoc",
                            })
                        }

                        const proposal: ActionProposal = preparedData.localizedData
                            ? {
                                  action: "create",
                                  collection,
                                  label: getSafeProposalLabel(label),
                                  localizedData: preparedData.localizedData,
                                  ...(activeLocale ? { locale: activeLocale } : {}),
                              }
                            : {
                                  action: "create",
                                  collection,
                                  data: preparedData.data || {},
                                  label: getSafeProposalLabel(label),
                                  ...(activeLocale ? { locale: activeLocale } : {}),
                              }

                        return addSignedProposal(proposal)
                    },
                },
                proposeDeleteDoc: {
                    description: "Propose document deletion.",
                    inputSchema: z.object({
                        collection: collectionSlugSchema,
                        id: z.string().min(1),
                        label: z.string().min(1),
                    }),
                    execute: async ({ collection, id, label }: CollectionInput & DocIDInput & LabelInput) => {
                        const permissionError = getDisallowedCollectionActionError(collection, "delete")
                        if (permissionError) return permissionError

                        const proposal: ActionProposal = {
                            action: "delete",
                            collection,
                            id,
                            label: getSafeProposalLabel(label),
                            ...(activeLocale ? { locale: activeLocale } : {}),
                        }

                        return addSignedProposal(proposal)
                    },
                },
                proposeUpdateDoc: {
                    description:
                        "Propose document update. Use exact schema fields. Use localizedData for multi-locale writes.",
                    inputSchema: z
                        .object({
                            collection: collectionSlugSchema,
                            data: z.record(z.string(), z.unknown()).optional(),
                            id: z.string().min(1),
                            label: z.string().min(1),
                            localizedData: nonEmptyLocalizedDataSchema.optional(),
                        })
                        .refine((value) => Boolean(value.data || value.localizedData), {
                            message: "Either data or localizedData is required.",
                        }),
                    execute: async ({
                        collection,
                        data,
                        id,
                        label,
                        localizedData,
                    }: CollectionInput & Partial<DataInput> & DocIDInput & LabelInput & { localizedData?: LocalizedDataInput }) => {
                        const permissionError = getDisallowedCollectionActionError(collection, "update")
                        if (permissionError) return permissionError
                        const collectionConfig = allowedCollectionsBySlug.get(collection)
                        const collectionFields = (collectionConfig?.fields || []) as BlockFieldConfig[]
                        const preparedData = prepareProposalWriteData({
                            collectionConfig: collectionConfig as ProposalCollectionConfig | undefined,
                            data,
                            inferenceText: prompt,
                            label,
                            localizedData,
                            mode: "update",
                        })

                        if (preparedData.issues.length > 0) {
                            return createToolError({
                                collection,
                                details: {
                                    issues: preparedData.issues,
                                },
                                message: `Update proposal for ${collection} is invalid. Retry with exact schema fields and complete array/block objects: ${formatProposalIssuesForRetry(preparedData.issues)}`,
                                tool: "proposeUpdateDoc",
                            })
                        }

                        const invalidRelationshipTargets = [
                            ...(preparedData.data
                                ? await validateRelationshipTargetsExist({
                                      data: preparedData.data,
                                      fields: collectionFields,
                                      req,
                                  })
                                : []),
                            ...(preparedData.localizedData
                                ? (
                                      await Promise.all(
                                          Object.values(preparedData.localizedData).map((localeData) =>
                                              validateRelationshipTargetsExist({
                                                  data: localeData,
                                                  fields: collectionFields,
                                                  req,
                                              })
                                          )
                                      )
                                  ).flat()
                                : []),
                        ]

                        if (invalidRelationshipTargets.length > 0) {
                            return createToolError({
                                collection,
                                details: {
                                    invalidRelationshipTargets,
                                },
                                message: `Update proposal for ${collection} contains relationship or upload references that do not exist: ${invalidRelationshipTargets.map((target) => `${target.path} -> ${target.collection}:${target.id}`).join(", ")}.`,
                                tool: "proposeUpdateDoc",
                            })
                        }

                        const uploadTargetsOutsideAttachments = [
                            ...(preparedData.data
                                ? getUploadTargetsOutsideAttachments({
                                      allowedAttachmentKeys,
                                      data: preparedData.data,
                                      fields: collectionFields,
                                  })
                                : []),
                            ...(preparedData.localizedData
                                ? Object.values(preparedData.localizedData).flatMap((localeData) =>
                                      getUploadTargetsOutsideAttachments({
                                          allowedAttachmentKeys,
                                          data: localeData,
                                          fields: collectionFields,
                                      })
                                  )
                                : []),
                        ]

                        if (uploadTargetsOutsideAttachments.length > 0) {
                            return createToolError({
                                collection,
                                details: {
                                    allowedAttachments: [...allowedAttachmentKeys],
                                    uploadTargetsOutsideAttachments,
                                },
                                message: `Update proposal for ${collection} uses upload references that are not in the uploaded attachments: ${uploadTargetsOutsideAttachments.map((target) => `${target.path} -> ${target.collection}:${target.id}`).join(", ")}. Use only uploaded media attachment IDs for upload fields.`,
                                tool: "proposeUpdateDoc",
                            })
                        }

                        const proposal: ActionProposal = {
                            action: "update",
                            collection,
                            ...(preparedData.localizedData ? { localizedData: preparedData.localizedData } : { data: preparedData.data || {} }),
                            id,
                            label: getSafeProposalLabel(label),
                            ...(activeLocale ? { locale: activeLocale } : {}),
                        }

                        return addSignedProposal(proposal)
                    },
                },
                proposeUpdateGlobal: {
                    description: "Propose global update. Use localizedData for multi-locale writes.",
                    inputSchema: z
                        .object({
                            data: z.record(z.string(), z.unknown()).optional(),
                            label: z.string().min(1),
                            localizedData: nonEmptyLocalizedDataSchema.optional(),
                            slug: z.string().min(1),
                        })
                        .refine((value) => Boolean(value.data || value.localizedData), {
                            message: "Either data or localizedData is required.",
                        }),
                    execute: async ({
                        data,
                        label,
                        localizedData,
                        slug,
                    }: Partial<DataInput> & LabelInput & SlugInput & { localizedData?: LocalizedDataInput }) => {
                        const globalConfig = globalConfigsBySlug.get(slug)
                        if (!globalConfig) {
                            return createToolError({
                                message: `Unknown global: ${slug}`,
                                slug,
                                tool: "proposeUpdateGlobal",
                            })
                        }
                        const preparedData = prepareProposalWriteData({
                            collectionConfig: {
                                fields: (globalConfig.fields || []) as ProposalFieldConfig[],
                                slug: globalConfig.slug,
                            },
                            data,
                            inferenceText: prompt,
                            label,
                            localizedData,
                            mode: "update",
                        })

                        if (preparedData.issues.length > 0) {
                            return createToolError({
                                details: {
                                    issues: preparedData.issues,
                                },
                                message: `Update proposal for global ${slug} is invalid. Retry with exact schema fields and complete array/block objects: ${formatProposalIssuesForRetry(preparedData.issues)}`,
                                slug,
                                tool: "proposeUpdateGlobal",
                            })
                        }

                        const proposal: ActionProposal = {
                            action: "updateGlobal",
                            ...(preparedData.localizedData ? { localizedData: preparedData.localizedData } : { data: preparedData.data || {} }),
                            label: getSafeProposalLabel(label),
                            ...(activeLocale ? { locale: activeLocale } : {}),
                            slug,
                        }

                        return addSignedProposal(proposal)
                    },
                },
                searchDocs: {
                    description: "Search documents in one collection.",
                    inputSchema: z.object({
                        collection: collectionSlugSchema,
                        limit: z.number().int().min(1).max(10).default(5),
                        query: z.string().optional(),
                    }),
                    execute: async ({ collection, limit, query }: CollectionInput & { limit: number; query?: string }) => {
                        const collectionConfig = allowedCollectionsBySlug.get(collection)
                        const searchableFields =
                            collectionConfig?.fields.flatMap((field) => {
                                if (!("name" in field) || !["email", "text", "textarea"].includes(field.type) || !field.name) return []

                                return [field.name]
                            }) || []

                        const where =
                            query && searchableFields.length > 0
                                ? {
                                      or: searchableFields.map((field) => ({
                                          [field as string]: {
                                              contains: query,
                                          },
                                      })),
                                  }
                                : undefined

                        return req.payload.find({
                            collection: collection as never,
                            depth: 1,
                            limit,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                            overrideAccess: false,
                            req,
                            where,
                        })
                    },
                },
            }
            const encoder = new TextEncoder()
            const sendEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            }

            const model = await getModel({
                apiKey: providerConfig.apiKey,
                model: providerConfig.modelID,
                provider,
            })

            const result = streamText({
                maxOutputTokens: options.maxOutputTokens || 700,
                model,
                prompt: buildPromptWithMentionContext({
                    mentionContext,
                    prompt,
                }),
                stopWhen: stepCountIs(6),
                system: [
                    "You are a Payload CMS assistant. Inspect schema/content with tools before proposing writes.",
                    "Mentions define the active CMS scope. Locale mentions define active locale; multiple locales require localizedData keyed by locale.",
                    "Writes are proposals only. Never claim changes were applied before user confirmation.",
                    "Uploaded media attachments appear in context as mediaAttachment entries. Use their exact IDs for upload fields.",
                    "If an uploaded media document has editable descriptive fields, propose an update to that media document with suitable values.",
                    "If a collection has a required `slug` field and the user does not provide it, generate a URL‑friendly slug from the title or from the first meaningful word of the prompt.",
                    "For create/update/delete requests, you must use proposal tools. Do not end with plain text if the user asked for a content change.",
                    "If the user asks to create, update, refine, translate, remove, or delete content, produce at least one proposal tool call unless blocked by missing schema information or permissions.",
                    "Put concrete field values only in tool data, not visible text.",
                    "For blocks fields: use exact blockType values from schema, exact field names, and complete objects for required block fields.",
                    "For arrays: every item must be an object matching the child field schema, not free text.",
                    "If schema details are missing, call listCollections/listGlobals with a slug before proposing. If an inferred collection schema is already present in context, use it directly.",
                    `Collection aliases: ${JSON.stringify(collectionAliasMap)}.`,
                    `Likely collection matches for this prompt: ${JSON.stringify(likelyCollectionMatches)}.`,
                    `Focused required create fields: ${JSON.stringify(focusedRequiredFieldsByCollection)}.`,
                    `Focused title fields: ${JSON.stringify(focusedTitleFieldByCollection)}. Infer concise titles when needed.`,
                    `Preferred proposal tool for this prompt: ${intentToolChoice?.toolName || "none"}.`,
                    "Visible response: plain text, under 40 words, no Markdown, no proposed content.",
                ].join("\n"),
                ...(intentToolChoice ? { toolChoice: intentToolChoice } : {}),
                tools,
            })

            const stream = new ReadableStream<Uint8Array>({
                start: async (controller) => {
                    let didSendTerminalEvent = false
                    let usage: TokenUsage | null = null

                    try {
                        for await (const part of result.fullStream) {
                            if (part.type === "text-delta") {
                                sendEvent(controller, "text", { delta: part.text })
                                continue
                            }

                            if (part.type === "error") {
                                didSendTerminalEvent = true
                                sendEvent(controller, "error", {
                                    error: "AI request failed.",
                                })
                                break
                            }

                            if (part.type === "finish") {
                                const finishPart = part as {
                                    totalUsage?: TokenUsage
                                    usage?: TokenUsage
                                }

                                usage = finishPart.totalUsage || finishPart.usage || null
                                const reason = getChatCompletionReason({
                                    proposalCount: proposals.length,
                                    toolFailures,
                                    writeIntent,
                                })
                                const debugPayload = createDebugPayload({
                                    activeLocale,
                                    debug,
                                    proposalCount: proposals.length,
                                    selectedLocales,
                                    toolFailures,
                                    usage,
                                    writeIntent,
                                })
                                logHandlerEvent(req, proposals.length > 0 ? "info" : "warn", {
                                    activeLocale,
                                    debug,
                                    msg: proposals.length > 0 ? "AI chat completed with proposals" : "AI chat completed without proposals",
                                    proposalCount: proposals.length,
                                    proposals: proposals.map((proposal) => getProposalSummary(proposal)),
                                    promptPreview: getLogPreview(prompt),
                                    reason,
                                    selectedLocales,
                                    toolFailureCount: toolFailures.length,
                                    toolFailures,
                                    usage,
                                })
                                sendEvent(controller, "proposals", { proposals, usage })
                                sendEvent(controller, "debug", debugPayload)
                                sendEvent(controller, "done", {})
                                didSendTerminalEvent = true
                            }
                        }

                        if (!didSendTerminalEvent) {
                            const reason = getChatCompletionReason({
                                proposalCount: proposals.length,
                                toolFailures,
                                writeIntent,
                            })
                            const debugPayload = createDebugPayload({
                                activeLocale,
                                debug,
                                proposalCount: proposals.length,
                                selectedLocales,
                                toolFailures,
                                usage,
                                writeIntent,
                            })
                            logHandlerEvent(req, proposals.length > 0 ? "info" : "warn", {
                                activeLocale,
                                debug,
                                msg: proposals.length > 0 ? "AI chat completed with proposals" : "AI chat completed without proposals",
                                proposalCount: proposals.length,
                                proposals: proposals.map((proposal) => getProposalSummary(proposal)),
                                promptPreview: getLogPreview(prompt),
                                reason,
                                selectedLocales,
                                toolFailureCount: toolFailures.length,
                                toolFailures,
                                usage,
                            })
                            sendEvent(controller, "proposals", { proposals, usage })
                            sendEvent(controller, "debug", debugPayload)
                            sendEvent(controller, "done", {})
                        }
                    } catch (err) {
                        req.payload.logger.error({
                            debug,
                            err,
                            msg: "AI chat stream failed",
                        })

                        if (!didSendTerminalEvent) {
                            sendEvent(controller, "error", {
                                error: "AI request failed.",
                            })
                        }
                    } finally {
                        controller.close()
                    }
                },
            })

            return new Response(stream, {
                headers: {
                    "Cache-Control": "no-cache, no-transform",
                    Connection: "keep-alive",
                    "Content-Type": "text/event-stream; charset=utf-8",
                },
            })
        } catch (err) {
            req.payload.logger.error({
                debug,
                err,
                msg: "AI chat request failed",
            })

            return Response.json(
                {
                    error: "AI request failed.",
                },
                { status: 500 }
            )
        }
    }

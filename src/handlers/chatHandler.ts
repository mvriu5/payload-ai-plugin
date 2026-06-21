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
    mentions?: ChatMention[]
    model?: string
    prompt?: string
    provider?: string
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
    reason: "model_did_not_call_tool" | "proposal_created" | "tool_validation_failed"
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

type RequiredFieldInfo = {
    defaultValue?: unknown
    isTitleField?: boolean
    localized: boolean
    options?: (string | { label?: unknown; value?: string })[]
    path: string
    type?: string
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

const getChatCompletionReason = ({ proposalCount, toolFailures }: { proposalCount: number; toolFailures: ToolFailure[] }) => {
    if (proposalCount > 0) return "proposal_created" as const
    if (toolFailures.length > 0) return "tool_validation_failed" as const
    return "model_did_not_call_tool" as const
}

const createDebugPayload = ({
    activeLocale,
    debug,
    proposalCount,
    selectedLocales,
    toolFailures,
    usage,
}: {
    activeLocale?: string
    debug: ChatDebug
    proposalCount: number
    selectedLocales: string[]
    toolFailures: ToolFailure[]
    usage?: TokenUsage | null
}): ChatDebugPayload => ({
    activeLocale,
    model: debug.model,
    proposalCount,
    provider: debug.provider,
    reason: getChatCompletionReason({
        proposalCount,
        toolFailures,
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

        for (const [locale, localeData] of locales) {
            for (const field of requiredFields.filter((item) => item.localized)) {
                if (!hasValueAtPath(localeData, field.path)) {
                    missing.push(`${locale}:${field.path}`)
                }
            }
        }

        for (const field of requiredFields.filter((item) => !item.localized)) {
            if (!hasValueAtPath(firstLocale[1], field.path)) {
                missing.push(`${firstLocale[0]}:${field.path}`)
            }
        }

        return missing
    }

    if (!data) return ["data is required"]

    return requiredFields.filter((field) => !hasValueAtPath(data, field.path)).map((field) => field.path)
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

const getMentionSummary = (mentions?: ChatMention[]) =>
    mentions?.map((mention) => ({
        collection: "collection" in mention ? mention.collection : undefined,
        id: "id" in mention ? mention.id : undefined,
        slug: mention.slug,
        type: mention.type,
    })) || []

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

export const createChatHandler =
    (options: ChatOptions = {}): PayloadHandler =>
    async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

        const body = req.json ? ((await req.json().catch(() => null)) as ChatBody | null) : null

        const prompt = body?.prompt?.trim()
        if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 })

        const selectedLocales = (
            body?.mentions?.filter((mention) => mention.type === "locale" && mention.slug).map((mention) => mention.slug as string) || []
        ).filter((locale, index, array) => array.indexOf(locale) === index)
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
            const globalSlugs = req.payload.config.globals?.map((global) => global.slug) || []
            const allowedCollections = req.payload.config.collections.filter((collection) => collectionSlugs.includes(collection.slug))

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
                ...(req.payload.config.globals?.flatMap((global) =>
                    collectBlocks({
                        fields: global.fields as FieldConfig[],
                        parent: global.slug,
                    })
                ) || []),
            ]
            const mentionContext = await getMentionContext({
                blockContexts,
                collectionSlugs,
                collections: options.collections,
                globalSlugs,
                mentions: body?.mentions,
                req,
            })
            const mentionedCollectionSlugs = (
                body?.mentions
                    ?.flatMap((mention) => {
                        if (mention.type === "collection" && mention.slug) return [mention.slug]
                        if (mention.type === "doc" && mention.collection) return [mention.collection]
                        return []
                    })
                    .filter((slug) => collectionSlugs.includes(slug)) || []
            ).filter((slug, index, array) => array.indexOf(slug) === index)
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
            logHandlerEvent(req, "info", {
                activeLocale,
                allowedCollectionCount: allowedCollections.length,
                collectionSlugs,
                focusedCollections: mentionedCollectionSlugs,
                globalSlugs,
                msg: "AI chat context prepared",
                selectedLocales,
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
                    description: "Read one document by collection slug and document id.",
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
                    description: "List AI-enabled Payload collections. Omit slug for compact summaries; pass slug to get full field schema for one collection.",
                    inputSchema: z.object({
                        slug: collectionSlugSchema.optional(),
                    }),
                    execute: async ({ slug }: OptionalSlugInput) => {
                        if (slug) {
                            const collection = allowedCollections.find((item) => item.slug === slug)
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
                    description: "Read one Payload CMS global by slug.",
                    inputSchema: z.object({
                        slug: z.string().min(1),
                    }),
                    execute: async ({ slug }: SlugInput) => {
                        const globalConfig = req.payload.config.globals?.find((global) => global.slug === slug)
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
                    description: "List Payload globals. Omit slug for compact summaries; pass slug to get full field schema for one global.",
                    inputSchema: z.object({
                        slug: z.string().optional(),
                    }),
                    execute: async ({ slug }: OptionalSlugInput) => {
                        const globals = req.payload.config.globals || []

                        if (slug) {
                            const global = globals.find((item) => item.slug === slug)
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

                        return globals.map((global) =>
                            describeCollectionLikeSummary({
                                config: global as never,
                                type: "global",
                            })
                        )
                    },
                },
                proposeCreateDoc: {
                    description:
                        "Prepare a CMS document creation proposal. This does not write to the database. Use exact field names from listCollections. Include every required field for the target collection. For localizedData, include every localized required field in every locale entry, and include non-localized required fields in the first locale entry. For array fields, provide arrays of objects matching their child fields. For richText fields, prefer plain text or omit if unsure. Use localizedData when writing multiple locales in one proposal.",
                    inputSchema: z
                        .object({
                            collection: collectionSlugSchema,
                            data: z.record(z.string(), z.unknown()).optional(),
                            label: z.string().min(1),
                            localizedData: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
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
                        const collectionConfig = allowedCollections.find((item) => item.slug === collection)
                        const preparedData = prepareProposalWriteData({
                            collectionConfig: collectionConfig as ProposalCollectionConfig | undefined,
                            data,
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
                    description: "Prepare a CMS document deletion proposal. This does not write to the database.",
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
                        "Prepare a CMS document update proposal. This does not write to the database. Use exact field names from listCollections. For array fields, provide arrays of objects matching their child fields. For richText fields, prefer plain text or omit if unsure. Use localizedData when writing multiple locales in one proposal.",
                    inputSchema: z
                        .object({
                            collection: collectionSlugSchema,
                            data: z.record(z.string(), z.unknown()).optional(),
                            id: z.string().min(1),
                            label: z.string().min(1),
                            localizedData: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
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
                        const collectionConfig = allowedCollections.find((item) => item.slug === collection)
                        const preparedData = prepareProposalWriteData({
                            collectionConfig: collectionConfig as ProposalCollectionConfig | undefined,
                            data,
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
                    description:
                        "Prepare a Payload global update proposal. This does not write to the database. Use localizedData when writing multiple locales in one proposal.",
                    inputSchema: z
                        .object({
                            data: z.record(z.string(), z.unknown()).optional(),
                            label: z.string().min(1),
                            localizedData: z.record(z.string(), z.record(z.string(), z.unknown())).optional(),
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
                        const globalConfig = req.payload.config.globals?.find((global) => global.slug === slug)
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
                    description: "Search documents in one collection. Use query for a loose text search where possible.",
                    inputSchema: z.object({
                        collection: collectionSlugSchema,
                        limit: z.number().int().min(1).max(10).default(5),
                        query: z.string().optional(),
                    }),
                    execute: async ({ collection, limit, query }: CollectionInput & { limit: number; query?: string }) => {
                        const collectionConfig = allowedCollections.find((item) => item.slug === collection)
                        const searchableFields =
                            collectionConfig?.fields
                                .filter((field) => "name" in field && ["email", "text", "textarea"].includes(field.type))
                                .map((field) => ("name" in field ? field.name : null))
                                .filter(Boolean) || []

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
                    "For create/update/delete use proposal tools. Put concrete field values only in tool data, not visible text.",
                    "For blocks fields: use exact blockType values from schema, exact field names, and complete objects for required block fields.",
                    "For arrays: every item must be an object matching the child field schema, not free text.",
                    "If schema details are missing, call listCollections/listGlobals with a slug before proposing.",
                    `Focused required create fields: ${JSON.stringify(focusedRequiredFieldsByCollection)}.`,
                    `Focused title fields: ${JSON.stringify(focusedTitleFieldByCollection)}. Infer concise titles when needed.`,
                    "Visible response: plain text, under 40 words, no Markdown, no proposed content.",
                ].join("\n"),
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
                                })
                                const debugPayload = createDebugPayload({
                                    activeLocale,
                                    debug,
                                    proposalCount: proposals.length,
                                    selectedLocales,
                                    toolFailures,
                                    usage,
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
                            })
                            const debugPayload = createDebugPayload({
                                activeLocale,
                                debug,
                                proposalCount: proposals.length,
                                selectedLocales,
                                toolFailures,
                                usage,
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

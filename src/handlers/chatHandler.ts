import type { PayloadHandler } from "payload"

import { stepCountIs, streamText } from "ai"
import { z } from "zod"

import { signAIActionProposal } from "../ai/proposalSigning.js"
import {
    compactProposalRepairIssues,
    createProposalRepairTracker,
    type CompactProposalRepairIssue,
} from "../ai/proposalRepair.js"
import { containsSensitiveData, isSensitiveKey, redactSensitiveData } from "../ai/sensitiveData.js"
import { resolveAIRequestContext, type AIRequestUser } from "../ai/requestContext.js"
import type { ActionProposal, LocalizedDataInput } from "../features/proposals/types.js"
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
import { getOptionValue, getSafeProposalLabel, hasLocalizedData, hasValueAtPath, isRecord, setValueAtPath } from "../payload/shared.js"
import { createLocalizedPayloadDataSchema, createPayloadDataSchema, genericPayloadDataSchema } from "../payload/toolSchemas.js"
import { createToolFieldNamesSchema, resolveToolFieldSelection, type ReadCollectionConfig } from "../payload/toolFieldSelection.js"
import { createCollectionAliasMap, getChatIntent, getIntentToolChoice, getLikelyCollectionMatches, getToolNamesForIntent } from "./chat/intent.js"
import { createChatPromptContext } from "./chat/prompt.js"
import {
    collectProposalBlockTypes,
    fillMissingCreateFields,
    getCollectionBlockTypes,
    getMissingCreateFields,
    getProposalSummary,
    getRequestedBlockTypes,
    getRequiredFieldInfos,
    getUploadTargetsOutsideAttachments,
    validateRelationshipTargetsExist,
    type BlockFieldConfig,
} from "./chat/proposalTools.js"
import { createDebugPayload, createE2EChatResponse, createInitialChatDebug, getChatCompletionReason } from "./chat/streaming.js"
import type { ChatBody, ChatMediaAttachment, ChatOptions, TokenUsage, ToolFailure } from "./chat/types.js"

const e2eModeEnabled = () => process.env.PAYLOAD_AI_E2E_MODE === "true"

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

type FieldsInput = {
    fields?: string[]
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
        const fieldSelection = resolveToolFieldSelection({
            config: collectionConfig as ReadCollectionConfig,
        })

        const doc = await req.payload
            .findByID({
                collection: attachment.collection as never,
                depth: fieldSelection.depth,
                id: attachment.id,
                overrideAccess: false,
                req,
                select: fieldSelection.select,
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

        const user = req.user as AIRequestUser
        const aiRequestResolution = await resolveAIRequestContext({
            options,
            req,
            requestedModel: body?.model,
            requestedProvider: body?.provider,
            user,
        })

        if (!aiRequestResolution.ok) {
            if (aiRequestResolution.error.code === "token_limit") {
                const exceededTokenUsageLimit = aiRequestResolution.error.tokenLimit
                const scope = options.maxTokenUsage?.type === "site" ? "site" : "user"
                const periodLabel = exceededTokenUsageLimit.period === "day" ? "Daily" : "Weekly"

                logHandlerEvent(req, "warn", {
                    limit: exceededTokenUsageLimit.limit,
                    msg: "AI chat blocked: token usage limit reached",
                    period: exceededTokenUsageLimit.period,
                    scope,
                    used: exceededTokenUsageLimit.used,
                    userID: String(user.id),
                })

                return Response.json(
                    {
                        error: `${periodLabel} AI token limit reached for this ${scope}.`,
                        limit: exceededTokenUsageLimit.limit,
                        period: exceededTokenUsageLimit.period,
                        used: exceededTokenUsageLimit.used,
                    },
                    { status: 429 }
                )
            }

            if (aiRequestResolution.error.code !== "missing_api_key") {
                return Response.json({ error: aiRequestResolution.error.message }, { status: 400 })
            }

            const missingKeyError = aiRequestResolution.error
            const debug = createInitialChatDebug({
                model: missingKeyError.modelID,
                provider: missingKeyError.providerID,
            })
            logHandlerEvent(req, "info", {
                activeLocale,
                debug,
                mentionCount: mentionSummary.length,
                mentions: mentionSummary,
                msg: "AI chat started",
                promptPreview: getLogPreview(prompt),
                selectedLocales,
            })
            logHandlerEvent(req, "warn", {
                activeLocale,
                debug,
                msg: "AI chat blocked: missing provider API key",
                promptPreview: getLogPreview(prompt),
                selectedLocales,
            })
            return Response.json(
                {
                    error: missingKeyError.managedProvider
                        ? `Configure a ${missingKeyError.providerID} API key in the plugin config or server environment first.`
                        : options.allowUserApiKeys === false
                          ? `Configure a ${missingKeyError.provider} API key in the server environment first.`
                          : `Add a ${missingKeyError.provider} API key to your account settings or configure it in the server environment first.`,
                },
                { status: 400 }
            )
        }
        const resolvedAIRequest = aiRequestResolution.context
        const provider = resolvedAIRequest.provider
        const managedProvider = resolvedAIRequest.managedProvider
        const debug = createInitialChatDebug({
            model: resolvedAIRequest.modelID,
            provider: resolvedAIRequest.providerID,
        })
        logHandlerEvent(req, "info", {
            activeLocale,
            debug,
            mentionCount: mentionSummary.length,
            mentions: mentionSummary,
            msg: "AI chat started",
            promptPreview: getLogPreview(prompt),
            selectedLocales,
        })

        try {
            const proposals: ActionProposal[] = []
            const toolFailures: ToolFailure[] = []
            const proposalRepairTracker = createProposalRepairTracker()
            const registerToolFailure = (failure: ToolFailure) => {
                toolFailures.push(failure)
                logHandlerEvent(req, "warn", {
                    debug,
                    ...failure,
                    msg: "AI tool validation failed",
                    promptPreview: getLogPreview(prompt),
                })
            }
            const createToolError = ({ collection, details, errorCode = "NON_RETRYABLE_TOOL_ERROR", message, slug, tool }: ToolFailure) => {
                registerToolFailure({
                    collection,
                    details,
                    errorCode,
                    message,
                    retryable: false,
                    slug,
                    tool,
                })

                return {
                    error: message,
                    errorCode,
                    retryable: false,
                }
            }
            const createRepairableToolError = ({
                collection,
                details,
                id,
                issues,
                message,
                slug,
                tool,
            }: ToolFailure & {
                id?: string
                issues: CompactProposalRepairIssue[]
            }) => {
                const repair = proposalRepairTracker.registerFailure({
                    collection,
                    id,
                    slug,
                    tool,
                })
                const responseMessage = repair.retryable
                    ? message
                    : "The single proposal repair attempt failed. Do not call the same proposal tool for this target again."
                registerToolFailure({
                    collection,
                    details,
                    errorCode: repair.errorCode,
                    message: responseMessage,
                    retryable: repair.retryable,
                    slug,
                    tool,
                })

                return {
                    error: responseMessage,
                    errorCode: repair.errorCode,
                    repair: {
                        attempt: repair.attempt,
                        issues,
                        maxAttempts: repair.maxAttempts,
                    },
                    retryable: repair.retryable,
                }
            }
            const getProposalRepairLimitError = ({
                collection,
                id,
                slug,
                tool,
            }: {
                collection?: string
                id?: string
                slug?: string
                tool: string
            }) => {
                const callState = proposalRepairTracker.beginCall({
                    collection,
                    id,
                    slug,
                    tool,
                })

                if (callState !== "blocked") return null

                return createToolError({
                    collection,
                    errorCode: "REPAIR_EXHAUSTED",
                    message: "The single proposal repair attempt was already used. Do not call this proposal tool for the same target again.",
                    slug,
                    tool,
                })
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
            const requestedDocumentScope = body?.documentScope
            const configuredCollectionSlugs = getAllowedCollectionSlugs(req, options.collections)
            const configuredCollectionSlugSet = new Set(configuredCollectionSlugs)
            const allGlobalConfigs = req.payload.config.globals || []
            const requestedCollectionSlug =
                requestedDocumentScope?.type === "collection" && typeof requestedDocumentScope.collection === "string"
                    ? requestedDocumentScope.collection.trim()
                    : undefined
            const requestedGlobalSlug =
                requestedDocumentScope?.type === "global" && typeof requestedDocumentScope.slug === "string" ? requestedDocumentScope.slug.trim() : undefined
            const requestedDocumentID =
                requestedDocumentScope?.type === "collection" && typeof requestedDocumentScope.id === "string" ? requestedDocumentScope.id.trim() : undefined

            if (requestedDocumentScope?.type === "collection" && (!requestedCollectionSlug || !configuredCollectionSlugSet.has(requestedCollectionSlug))) {
                return Response.json({ error: "The current collection is not available to the AI assistant." }, { status: 400 })
            }
            if (
                requestedDocumentScope?.type === "global" &&
                (!requestedGlobalSlug || !allGlobalConfigs.some((global) => global.slug === requestedGlobalSlug))
            ) {
                return Response.json({ error: "The current global is not available to the AI assistant." }, { status: 400 })
            }

            const collectionSlugs = requestedDocumentScope ? (requestedCollectionSlug ? [requestedCollectionSlug] : []) : configuredCollectionSlugs
            const collectionSlugSet = new Set(collectionSlugs)
            const globalConfigs = requestedDocumentScope
                ? requestedGlobalSlug
                    ? allGlobalConfigs.filter((global) => global.slug === requestedGlobalSlug)
                    : []
                : allGlobalConfigs
            const globalSlugs = globalConfigs.map((global) => global.slug)
            const globalConfigsBySlug = new Map(globalConfigs.map((global) => [global.slug, global]))
            const allowedCollections = req.payload.config.collections.filter((collection) => collectionSlugSet.has(collection.slug))
            const allowedCollectionsBySlug = new Map(allowedCollections.map((collection) => [collection.slug, collection]))

            if (collectionSlugs.length === 0 && globalConfigs.length === 0) {
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
            const explicitlyMentionedDocumentKeys = new Set(
                (body?.mentions || []).flatMap((mention) =>
                    mention.type === "doc" && mention.collection && mention.id ? [`${mention.collection}:${mention.id}`] : []
                )
            )
            const explicitlyMentionedGlobalSlugs = new Set(
                (body?.mentions || []).flatMap((mention) => (mention.type === "global" && mention.slug ? [mention.slug] : []))
            )
            const mentionContext = await getMentionContext({
                blockContexts,
                collectionSlugs,
                collections: options.collections,
                globalSlugs,
                mentions: body?.mentions,
                req,
            })
            if (requestedCollectionSlug && requestedDocumentID) {
                const currentDocumentKey = `${requestedCollectionSlug}:${requestedDocumentID}`

                if (explicitlyMentionedDocumentKeys.has(currentDocumentKey)) {
                    mentionContext.push({
                        collection: requestedCollectionSlug,
                        id: requestedDocumentID,
                        source: "mention",
                        type: "currentDocumentScope",
                    })
                } else {
                    const currentCollectionConfig = allowedCollectionsBySlug.get(requestedCollectionSlug)
                    const fieldSelection = resolveToolFieldSelection({
                        config: currentCollectionConfig as ReadCollectionConfig,
                    })
                    const currentDocument = await req.payload.findByID({
                        collection: requestedCollectionSlug as never,
                        depth: fieldSelection.depth,
                        id: requestedDocumentID,
                        ...(activeLocale ? { locale: activeLocale } : {}),
                        overrideAccess: false,
                        req,
                        select: fieldSelection.select,
                    })
                    mentionContext.push({
                        collection: requestedCollectionSlug,
                        document: currentDocument,
                        id: requestedDocumentID,
                        type: "currentDocument",
                    })
                }
            } else if (requestedGlobalSlug) {
                if (explicitlyMentionedGlobalSlugs.has(requestedGlobalSlug)) {
                    mentionContext.push({
                        slug: requestedGlobalSlug,
                        source: "mention",
                        type: "currentGlobalScope",
                    })
                } else {
                    const currentGlobalConfig = globalConfigsBySlug.get(requestedGlobalSlug)
                    const fieldSelection = resolveToolFieldSelection({
                        config: currentGlobalConfig as ReadCollectionConfig,
                    })
                    const currentGlobal = await req.payload.findGlobal({
                        depth: fieldSelection.depth,
                        ...(activeLocale ? { locale: activeLocale } : {}),
                        overrideAccess: false,
                        req,
                        select: fieldSelection.select,
                        slug: requestedGlobalSlug as never,
                    })
                    mentionContext.push({
                        global: currentGlobal,
                        slug: requestedGlobalSlug,
                        type: "currentGlobal",
                    })
                }
            }
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
            const chatIntent = getChatIntent({
                hasCurrentDocument: Boolean(requestedCollectionSlug && requestedDocumentID),
                hasCurrentGlobal: Boolean(requestedGlobalSlug),
                prompt,
            })
            const writeIntent = ["create", "delete", "update", "updateGlobal"].includes(chatIntent)
            const inferredCollectionSlug =
                requestedCollectionSlug ||
                (mentionedCollectionSlugs.length === 1
                    ? mentionedCollectionSlugs[0]
                    : mentionedCollectionSlugs.length === 0 && likelyCollectionMatches.length === 1
                      ? likelyCollectionMatches[0]
                      : undefined)
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
            if (requestedGlobalSlug) {
                const currentGlobalConfig = globalConfigsBySlug.get(requestedGlobalSlug)
                if (currentGlobalConfig) {
                    mentionContext.push(
                        describeCollectionLikeConfig({
                            config: currentGlobalConfig as never,
                            type: "global",
                        })
                    )
                }
            }
            let intentToolChoice = getIntentToolChoice({
                hasKnownCollection: Boolean(inferredCollectionConfig),
                hasKnownDocument: Boolean(requestedCollectionSlug && requestedDocumentID),
                hasKnownGlobal: Boolean(requestedGlobalSlug),
                intent: chatIntent,
            })
            logHandlerEvent(req, "info", {
                activeLocale,
                allowedCollectionCount: allowedCollections.length,
                chatIntent,
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
            const collectionSlugSchema =
                collectionSlugs.length > 0 ? z.enum(collectionSlugs as [string, ...string[]]) : z.string().refine(() => false, "No collection is in scope.")
            const focusedCollectionDataSchema = createPayloadDataSchema(inferredCollectionConfig as ProposalCollectionConfig | undefined)
            const focusedCollectionSlugSchema = inferredCollectionSlug ? z.literal(inferredCollectionSlug) : collectionSlugSchema
            const focusedGlobalConfig = requestedGlobalSlug ? globalConfigsBySlug.get(requestedGlobalSlug) : undefined
            const focusedGlobalDataSchema = createPayloadDataSchema(focusedGlobalConfig as ProposalCollectionConfig | undefined)
            const collectionReadFieldsSchema = createToolFieldNamesSchema(allowedCollections as ReadCollectionConfig[])
            const globalReadFieldsSchema = createToolFieldNamesSchema(globalConfigs as ReadCollectionConfig[])
            const createDataSchema = inferredCollectionConfig ? focusedCollectionDataSchema : genericPayloadDataSchema
            const createLocalizedDataSchema = createLocalizedPayloadDataSchema(createDataSchema)
            const updateHasMultipleTargets = mediaAttachmentContext.length > 0 && !requestedDocumentID
            const updateDataSchema = inferredCollectionConfig && !updateHasMultipleTargets ? focusedCollectionDataSchema : genericPayloadDataSchema
            const updateLocalizedDataSchema = createLocalizedPayloadDataSchema(updateDataSchema)
            const globalDataSchema = focusedGlobalConfig ? focusedGlobalDataSchema : genericPayloadDataSchema
            const globalLocalizedDataSchema = createLocalizedPayloadDataSchema(globalDataSchema)
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
            const allTools = {
                getDoc: {
                    description:
                        "Read a compact document by collection and id. Optionally request up to 12 exact top-level schema fields. Explicitly @-mentioned documents remain complete.",
                    inputSchema: z.object({
                        collection: collectionSlugSchema,
                        fields: collectionReadFieldsSchema,
                        id: z.string().min(1),
                    }),
                    execute: async ({ collection, fields, id }: CollectionInput & DocIDInput & FieldsInput) => {
                        if (requestedDocumentScope && (collection !== requestedCollectionSlug || id !== requestedDocumentID)) {
                            return createToolError({
                                collection,
                                message: "Only the current document can be read in this context.",
                                tool: "getDoc",
                            })
                        }
                        const explicitlyMentioned = explicitlyMentionedDocumentKeys.has(`${collection}:${id}`)
                        const collectionConfig = allowedCollectionsBySlug.get(collection)
                        const fieldSelection = resolveToolFieldSelection({
                            config: collectionConfig as ReadCollectionConfig,
                            requestedFields: fields,
                        })
                        if (!explicitlyMentioned && fieldSelection.invalidFields.length > 0) {
                            return createToolError({
                                collection,
                                details: {
                                    invalidFields: fieldSelection.invalidFields,
                                },
                                errorCode: "INVALID_FIELD_SELECTION",
                                message: `Unknown or sensitive fields requested for ${collection}: ${fieldSelection.invalidFields.join(", ")}.`,
                                tool: "getDoc",
                            })
                        }
                        const document = await req.payload.findByID({
                            collection: collection as never,
                            depth: explicitlyMentioned ? 2 : fieldSelection.depth,
                            id,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                            overrideAccess: false,
                            req,
                            ...(!explicitlyMentioned ? { select: fieldSelection.select } : {}),
                        })

                        return redactSensitiveData(document)
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
                    description:
                        "Read a compact global. Optionally request up to 12 exact top-level schema fields. Explicitly @-mentioned globals remain complete.",
                    inputSchema: z.object({
                        fields: globalReadFieldsSchema,
                        slug: z.string().min(1),
                    }),
                    execute: async ({ fields, slug }: FieldsInput & SlugInput) => {
                        if (requestedDocumentScope && slug !== requestedGlobalSlug) {
                            return createToolError({
                                message: "Only the current global can be read in this context.",
                                slug,
                                tool: "getGlobal",
                            })
                        }
                        const globalConfig = globalConfigsBySlug.get(slug)
                        if (!globalConfig) {
                            return createToolError({
                                message: `Unknown global: ${slug}`,
                                slug,
                                tool: "getGlobal",
                            })
                        }
                        const explicitlyMentioned = explicitlyMentionedGlobalSlugs.has(slug)
                        const fieldSelection = resolveToolFieldSelection({
                            config: globalConfig as ReadCollectionConfig,
                            requestedFields: fields,
                        })
                        if (!explicitlyMentioned && fieldSelection.invalidFields.length > 0) {
                            return createToolError({
                                details: {
                                    invalidFields: fieldSelection.invalidFields,
                                },
                                errorCode: "INVALID_FIELD_SELECTION",
                                message: `Unknown or sensitive fields requested for global ${slug}: ${fieldSelection.invalidFields.join(", ")}.`,
                                slug,
                                tool: "getGlobal",
                            })
                        }

                        const global = await req.payload.findGlobal({
                            depth: explicitlyMentioned ? 2 : fieldSelection.depth,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                            overrideAccess: false,
                            req,
                            ...(!explicitlyMentioned ? { select: fieldSelection.select } : {}),
                            slug: slug as never,
                        })

                        return redactSensitiveData(global)
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
                    description: "Propose document creation. Use exact schema fields; include required fields. Use localizedData for multi-locale writes.",
                    inputSchema: z
                        .object({
                            collection: focusedCollectionSlugSchema,
                            data: createDataSchema.optional(),
                            label: z.string().min(1),
                            localizedData: createLocalizedDataSchema.optional(),
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
                        const repairTargetID = getSafeProposalLabel(label)
                        const repairLimitError = getProposalRepairLimitError({
                            collection,
                            id: repairTargetID,
                            tool: "proposeCreateDoc",
                        })
                        if (repairLimitError) return repairLimitError
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

                            return createRepairableToolError({
                                collection,
                                details: {
                                    issues: preparedData.issues,
                                    titleFieldName,
                                },
                                id: repairTargetID,
                                issues: compactProposalRepairIssues(preparedData.issues),
                                message: missingTitleField
                                    ? `Create proposal is missing the required title field "${titleFieldName}" for ${collection}.`
                                    : `Create proposal data for ${collection} is invalid. Correct only repair.issues and call the same tool once more.`,
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
                                return createRepairableToolError({
                                    collection,
                                    details: {
                                        missingBlockTypes,
                                        requestedBlockTypes,
                                    },
                                    id: repairTargetID,
                                    issues: missingBlockTypes.map((blockType) => ({
                                        code: "missing_requested_block",
                                        hint: `Add a complete "${blockType}" block using the exact blockType and schema fields.`,
                                        path: "blocks",
                                    })),
                                    message: `Create proposal for ${collection} is missing requested block types: ${missingBlockTypes.join(", ")}.`,
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
                        if (requestedDocumentScope && (collection !== requestedCollectionSlug || id !== requestedDocumentID)) {
                            return createToolError({
                                collection,
                                message: "Only the current document can be deleted in this context.",
                                tool: "proposeDeleteDoc",
                            })
                        }
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
                    description: "Propose document update. Use exact schema fields. Use localizedData for multi-locale writes.",
                    inputSchema: z
                        .object({
                            collection: updateHasMultipleTargets ? collectionSlugSchema : focusedCollectionSlugSchema,
                            data: updateDataSchema.optional(),
                            id: z.string().min(1),
                            label: z.string().min(1),
                            localizedData: updateLocalizedDataSchema.optional(),
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
                        if (requestedDocumentScope && (collection !== requestedCollectionSlug || id !== requestedDocumentID)) {
                            return createToolError({
                                collection,
                                message: "Only the current document can be updated in this context.",
                                tool: "proposeUpdateDoc",
                            })
                        }
                        const permissionError = getDisallowedCollectionActionError(collection, "update")
                        if (permissionError) return permissionError
                        const repairLimitError = getProposalRepairLimitError({
                            collection,
                            id,
                            tool: "proposeUpdateDoc",
                        })
                        if (repairLimitError) return repairLimitError
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
                            return createRepairableToolError({
                                collection,
                                details: {
                                    issues: preparedData.issues,
                                },
                                id,
                                issues: compactProposalRepairIssues(preparedData.issues),
                                message: `Update proposal data for ${collection}:${id} is invalid. Correct only repair.issues and call the same tool once more.`,
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
                            data: globalDataSchema.optional(),
                            label: z.string().min(1),
                            localizedData: globalLocalizedDataSchema.optional(),
                            slug: requestedGlobalSlug ? z.literal(requestedGlobalSlug) : z.string().min(1),
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
                        if (requestedDocumentScope && slug !== requestedGlobalSlug) {
                            return createToolError({
                                message: "Only the current global can be updated in this context.",
                                slug,
                                tool: "proposeUpdateGlobal",
                            })
                        }
                        const globalConfig = globalConfigsBySlug.get(slug)
                        if (!globalConfig) {
                            return createToolError({
                                message: `Unknown global: ${slug}`,
                                slug,
                                tool: "proposeUpdateGlobal",
                            })
                        }
                        const repairLimitError = getProposalRepairLimitError({
                            slug,
                            tool: "proposeUpdateGlobal",
                        })
                        if (repairLimitError) return repairLimitError
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
                            return createRepairableToolError({
                                details: {
                                    issues: preparedData.issues,
                                },
                                issues: compactProposalRepairIssues(preparedData.issues),
                                message: `Update proposal data for global ${slug} is invalid. Correct only repair.issues and call the same tool once more.`,
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
                    description:
                        "Search compact documents in one collection. Returns default identity fields or up to 12 requested exact top-level schema fields.",
                    inputSchema: z.object({
                        collection: collectionSlugSchema,
                        fields: collectionReadFieldsSchema,
                        limit: z.number().int().min(1).max(10).default(5),
                        query: z.string().optional(),
                    }),
                    execute: async ({ collection, fields, limit, query }: CollectionInput & FieldsInput & { limit: number; query?: string }) => {
                        const collectionConfig = allowedCollectionsBySlug.get(collection)
                        const fieldSelection = resolveToolFieldSelection({
                            config: collectionConfig as ReadCollectionConfig,
                            mode: "search",
                            requestedFields: fields,
                        })
                        if (fieldSelection.invalidFields.length > 0) {
                            return createToolError({
                                collection,
                                details: {
                                    invalidFields: fieldSelection.invalidFields,
                                },
                                errorCode: "INVALID_FIELD_SELECTION",
                                message: `Unknown or sensitive fields requested for ${collection}: ${fieldSelection.invalidFields.join(", ")}.`,
                                tool: "searchDocs",
                            })
                        }
                        const searchableFields =
                            collectionConfig?.fields.flatMap((field) => {
                                if (
                                    !("name" in field) ||
                                    !["email", "text", "textarea"].includes(field.type) ||
                                    !field.name ||
                                    isSensitiveKey(field.name)
                                )
                                    return []

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

                        const result = await req.payload.find({
                            collection: collection as never,
                            depth: fieldSelection.depth,
                            limit,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                            overrideAccess: false,
                            req,
                            select: fieldSelection.select,
                            where,
                        })

                        return redactSensitiveData({
                            docs: result.docs,
                            hasNextPage: result.hasNextPage,
                        })
                    },
                },
            }
            const scopedToolNames = getToolNamesForIntent({
                hasAttachments: Boolean(body?.attachments?.length),
                hasKnownCollection: Boolean(inferredCollectionConfig),
                hasCurrentDocument: Boolean(requestedCollectionSlug && requestedDocumentID),
                hasCurrentGlobal: Boolean(requestedGlobalSlug),
                intent: chatIntent,
            })
            const tools = Object.fromEntries(Object.entries(allTools).filter(([name]) => scopedToolNames.has(name)))
            debug.tools = Object.keys(tools)
            if (intentToolChoice && !scopedToolNames.has(intentToolChoice.toolName)) {
                intentToolChoice = undefined
            }
            const encoder = new TextEncoder()
            const sendEvent = (controller: ReadableStreamDefaultController<Uint8Array>, event: string, data: unknown) => {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            }

            const model = await resolvedAIRequest.loadModel()
            const promptCaching = options.promptCaching !== false
            const explicitPromptCaching = promptCaching && !managedProvider?.baseURL
            const { dynamicMentionContext, promptCacheProviderOptions, system } = createChatPromptContext({
                chatIntent,
                collectionAliasMap,
                focusedRequiredFieldsByCollection,
                focusedTitleFieldByCollection,
                intentToolName: intentToolChoice?.toolName,
                likelyCollectionMatches,
                mentionContext,
                modelID: resolvedAIRequest.modelID,
                promptCaching: explicitPromptCaching,
                provider,
                scopedToolNames,
            })

            const result = streamText({
                maxOutputTokens: options.maxOutputTokens || 700,
                model,
                prompt: buildPromptWithMentionContext({
                    mentionContext: dynamicMentionContext,
                    prompt,
                }),
                ...(promptCacheProviderOptions ? { providerOptions: promptCacheProviderOptions } : {}),
                stopWhen: stepCountIs(6),
                system,
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
                                if (usage) {
                                    try {
                                        await resolvedAIRequest.recordUsage(usage)
                                    } catch (err) {
                                        req.payload.logger.error({
                                            err,
                                            msg: "AI token usage could not be recorded",
                                            userID: String(user.id),
                                        })
                                    }
                                }
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

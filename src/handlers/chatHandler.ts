import type { PayloadHandler } from "payload"

import { stepCountIs, streamText } from "ai"
import { z } from "zod"

import { signAIActionProposal, type AIActionSignature } from "../ai/proposalSigning.js"
import { isAIProvider, type AIModelConfig, type AIProvider } from "../ai/providerOptions.js"
import { getModel, getProviderConfig } from "../ai/providerRuntime.js"
import { containsSensitiveData } from "../ai/sensitiveData.js"
import { isCollectionActionAllowed, type CollectionAction, type ResolvedCollectionPermissionMap } from "../payload/collectionPermissions.js"
import {
    buildPromptWithMentionContext,
    collectBlocks,
    describeCollectionLikeConfig,
    getAllowedCollectionSlugs,
    getMentionContext,
    type ChatMention,
    type FieldConfig,
} from "../payload/schemaContext.js"
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

export const createChatHandler =
    (options: ChatOptions = {}): PayloadHandler =>
    async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

        const body = req.json ? ((await req.json().catch(() => null)) as ChatBody | null) : null

        const prompt = body?.prompt?.trim()
        if (!prompt) return Response.json({ error: "Prompt is required" }, { status: 400 })

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

        if (!providerConfig.apiKey) {
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
            const addSignedProposal = <Proposal extends ActionProposal>(proposal: Proposal) => {
                if ("data" in proposal && proposal.data && containsSensitiveData(proposal.data)) {
                    return {
                        error: "Proposal contains sensitive fields and cannot be created.",
                    }
                }

                if (
                    "localizedData" in proposal &&
                    hasLocalizedData(proposal.localizedData) &&
                    Object.values(proposal.localizedData).some((value) => containsSensitiveData(value))
                ) {
                    return {
                        error: "Proposal contains sensitive fields and cannot be created.",
                    }
                }

                const signedProposal = signAIActionProposal(proposal)

                proposals.push(signedProposal)
                return signedProposal
            }
            const collectionSlugs = getAllowedCollectionSlugs(req, options.collections)
            const globalSlugs = req.payload.config.globals?.map((global) => global.slug) || []
            const allowedCollections = req.payload.config.collections.filter((collection) => collectionSlugs.includes(collection.slug))

            if (collectionSlugs.length === 0) {
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
            const selectedLocales = (
                body?.mentions?.filter((mention) => mention.type === "locale" && mention.slug).map((mention) => mention.slug as string) || []
            ).filter((locale, index, array) => array.indexOf(locale) === index)
            const activeLocale = selectedLocales.at(-1)
            const createRequiredFieldsByCollection = Object.fromEntries(
                allowedCollections.map((collection) => [
                    collection.slug,
                    getRequiredFieldInfos(collection.fields as FieldConfig[], collection.admin?.useAsTitle),
                ])
            )
            const titleFieldByCollection = Object.fromEntries(
                allowedCollections.flatMap((collection) => (collection.admin?.useAsTitle ? [[collection.slug, collection.admin.useAsTitle]] : []))
            )
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

                return {
                    error: `${action} is not enabled for collection: ${collection}`,
                }
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
                    description: "List all Payload CMS collections available in this app.",
                    inputSchema: z.object({}),
                    execute: async () => {
                        return allowedCollections.map((collection) =>
                            describeCollectionLikeConfig({
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
                        if (!globalConfig) return { error: `Unknown global: ${slug}` }

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
                    description: "List all Payload CMS globals available in this app.",
                    inputSchema: z.object({}),
                    execute: async () => {
                        return (
                            req.payload.config.globals?.map((global) =>
                                describeCollectionLikeConfig({
                                    config: global as never,
                                    type: "global",
                                })
                            ) || []
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
                        const completedCreatePayload = fillMissingCreateFields({
                            data,
                            label,
                            localizedData,
                            requiredFields: createRequiredFieldsByCollection[collection] || [],
                        })
                        const missingFields = getMissingCreateFields({
                            data: completedCreatePayload.data,
                            localizedData: completedCreatePayload.localizedData,
                            requiredFields: createRequiredFieldsByCollection[collection] || [],
                        })

                        if (missingFields.length > 0) {
                            const titleFieldName = titleFieldByCollection[collection]
                            const missingTitleField = titleFieldName
                                ? missingFields.some((field) => field === titleFieldName || field.endsWith(`:${titleFieldName}`))
                                : false

                            return {
                                error: missingTitleField
                                    ? `Create proposal is missing the required title field "${titleFieldName}" for ${collection}. Infer a concise title from the user request and retry.`
                                    : `Create proposal is missing required fields for ${collection}: ${missingFields.join(", ")}`,
                            }
                        }

                        const proposal: ActionProposal = completedCreatePayload.localizedData
                            ? {
                                  action: "create",
                                  collection,
                                  label: getSafeProposalLabel(label),
                                  localizedData: completedCreatePayload.localizedData,
                                  ...(activeLocale ? { locale: activeLocale } : {}),
                              }
                            : {
                                  action: "create",
                                  collection,
                                  data: completedCreatePayload.data || {},
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

                        const proposal: ActionProposal = {
                            action: "update",
                            collection,
                            ...(localizedData ? { localizedData } : { data: data || {} }),
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
                        if (!globalConfig) return { error: `Unknown global: ${slug}` }

                        const proposal: ActionProposal = {
                            action: "updateGlobal",
                            ...(localizedData ? { localizedData } : { data: data || {} }),
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
                maxOutputTokens: options.maxOutputTokens || 1000,
                model,
                prompt: buildPromptWithMentionContext({
                    mentionContext,
                    prompt,
                }),
                stopWhen: stepCountIs(6),
                system: [
                    "You are a CMS assistant inside Payload CMS.",
                    "Use tools to inspect CMS schema and content before answering content questions.",
                    "When mention context is provided, use it as the selected CMS scope and prefer it over guessing collection names.",
                    "When a locale is selected in mention context, treat it as the active locale for reads, translations, and localized update proposals.",
                    "When multiple locales are selected, create one proposal that uses localizedData with one top-level key per locale code instead of separate proposals.",
                    `For create proposals, always include all required fields. Required create fields by collection: ${JSON.stringify(createRequiredFieldsByCollection)}.`,
                    `Title fields by collection: ${JSON.stringify(titleFieldByCollection)}. If the user asks to create content and does not supply a title explicitly, infer a concise title from the request and include it in the create proposal.`,
                    "If a create proposal would otherwise miss a simple required field like title, name, label, headline, _status, checkbox, or a select/radio default, include it in the tool call instead of omitting it.",
                    "Never claim that a write has been applied unless the user confirms an action proposal in the UI.",
                    "For create, update, and delete requests, call the proposal tools instead of directly changing data.",
                    "Keep the visible response under 40 words and describe only what kind of change was proposed.",
                    "Write visible responses as plain text only. Do not use Markdown formatting, bold markers (**), headings, bullets, tables, or code fences.",
                    "Do not include proposed field values, full replacement text, quoted content, markdown sections, code blocks, or headings like 'New content'/'Neuer Inhalt' in the visible response.",
                    "Put all concrete field values and replacement content only in proposal tool data. Proposal labels must be short action summaries and must not contain proposed content.",
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
                                sendEvent(controller, "proposals", { proposals, usage })
                                sendEvent(controller, "done", {})
                                didSendTerminalEvent = true
                            }
                        }

                        if (!didSendTerminalEvent) {
                            sendEvent(controller, "proposals", { proposals, usage })
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

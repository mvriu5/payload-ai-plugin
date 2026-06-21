import type { PayloadHandler } from "payload"

import { verifyActionProposal } from "../ai/proposalSigning.js"
import { containsSensitiveData, redactSensitiveData } from "../ai/sensitiveData.js"
import { type CollectionConfig, type FieldConfig, getSchemaFields } from "../payload/normalizeData.js"
import { applyLocalizedRequiredFallbackToPreparedData, prepareProposalWriteData } from "../payload/proposalData.js"
import type { ActionProposal } from "./chatHandler.js"
import { isCollectionActionAllowed, type CollectionAction, type ResolvedCollectionPermissionMap } from "../payload/collectionPermissions.js"
import {
    getDefaultLocale,
    getJSONLineKey,
    getOptionalNumber,
    hasLocalizedData,
    isActionProposal,
    isKnownGlobal,
    isRecord,
    mergeData,
} from "../payload/shared.js"
import { getLogPreview, logHandlerEvent } from "../payload/logging.js"

type ApplyActionBody = {
    aiResponse?: string
    tokenUsage?: {
        inputTokens?: unknown
        outputTokens?: unknown
        totalTokens?: unknown
    }
    prompt?: string
    proposal?: ActionProposal
}

type ApplyActionOptions = {
    changeLogCollection?: string
    collections?: ResolvedCollectionPermissionMap
}

type ApplyActionLogContext = {
    aiResponse?: string
    prompt?: string
    tokenUsage?: {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
    }
}

type AppliedDoc = {
    id?: unknown
}

type ProposalMeta = {
    action?: unknown
    collection?: unknown
    id?: unknown
    slug?: unknown
}

type ChangeLogTarget = {
    after: unknown
    before: unknown
    documentID?: unknown
}

type ApplyDebugPayload = {
    action?: unknown
    collection?: unknown
    details?: Record<string, unknown>
    id?: unknown
    phase: "apply_validation" | "authorization" | "payload_operation"
    reason: string
    slug?: unknown
}

const getProposalLogSummary = (proposal: ActionProposal) => ({
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

const getProposalMeta = (proposal?: Partial<ActionProposal>): ProposalMeta => {
    if (!proposal) return {}

    return {
        action: proposal.action,
        collection: "collection" in proposal ? proposal.collection : undefined,
        id: "id" in proposal ? proposal.id : undefined,
        slug: "slug" in proposal ? proposal.slug : undefined,
    }
}

const createApplyDebugPayload = ({
    details,
    phase,
    proposal,
    reason,
}: {
    details?: Record<string, unknown>
    phase: ApplyDebugPayload["phase"]
    proposal?: Partial<ActionProposal>
    reason: string
}): ApplyDebugPayload => ({
    ...getProposalMeta(proposal),
    details,
    phase,
    reason,
})

const getAppliedDocReference = (doc: AppliedDoc | null | undefined) => {
    return doc?.id === undefined ? undefined : { id: doc.id }
}

const isAllowedCollection = (
    req: Parameters<PayloadHandler>[0],
    collection: string,
    collections?: ResolvedCollectionPermissionMap,
    action: CollectionAction = "read"
) => {
    return isCollectionActionAllowed({
        action,
        permissions: collections,
        req,
        slug: collection,
    })
}

const countDiffChanges = ({ after, before }: { after: unknown; before: unknown }) => {
    const beforeLines = JSON.stringify(before, null, 2).split("\n")
    const afterLines = JSON.stringify(after, null, 2).split("\n")
    const dp = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0) as number[])
    let additions = 0
    let removals = 0

    for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
        for (let j = afterLines.length - 1; j >= 0; j -= 1) {
            dp[i][j] = beforeLines[i] === afterLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
    }

    let beforeIndex = 0
    let afterIndex = 0

    while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
        if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        const beforeKey = getJSONLineKey(beforeLines[beforeIndex])
        const afterKey = getJSONLineKey(afterLines[afterIndex])

        if (beforeKey && beforeKey === afterKey) {
            removals += 1
            additions += 1
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        if (dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]) {
            removals += 1
            beforeIndex += 1
        } else {
            additions += 1
            afterIndex += 1
        }
    }

    removals += beforeLines.length - beforeIndex
    additions += afterLines.length - afterIndex

    return { additions, removals }
}

const getTargetURL = ({ documentID, proposal, req }: { documentID?: unknown; proposal: ActionProposal; req: Parameters<PayloadHandler>[0] }) => {
    const adminRoute = req.payload.config.routes.admin || "/admin"

    if (proposal.action === "updateGlobal") return `${adminRoute}/globals/${proposal.slug}`
    if (proposal.action === "delete") return null

    const id = proposal.action === "create" ? documentID : proposal.id

    if (!id) return null

    return `${adminRoute}/collections/${proposal.collection}/${id}`
}

const getUserID = (req: Parameters<PayloadHandler>[0]) => {
    const user = req.user as { id?: unknown } | null | undefined
    return user?.id === undefined ? undefined : String(user.id)
}

const getUserLabel = (req: Parameters<PayloadHandler>[0]) => {
    const user = req.user as
        | {
              email?: unknown
              id?: unknown
              name?: unknown
              username?: unknown
          }
        | null
        | undefined

    if (typeof user?.email === "string" && user.email) return user.email
    if (typeof user?.name === "string" && user.name) return user.name
    if (typeof user?.username === "string" && user.username) return user.username
    if (user?.id !== undefined) return String(user.id)

    return null
}

const logAIChange = async ({
    changeLogCollection,
    context,
    target,
    proposal,
    req,
}: {
    changeLogCollection?: string
    context?: ApplyActionLogContext
    proposal: ActionProposal
    req: Parameters<PayloadHandler>[0]
    target: ChangeLogTarget
}) => {
    if (!changeLogCollection) return null

    const before = redactSensitiveData(target.before)
    const after = redactSensitiveData(target.after)
    const { additions, removals } = countDiffChanges({ after, before })
    const proposalForLog = { ...proposal } as Record<string, unknown>

    delete proposalForLog._aiSignature

    try {
        await req.payload.create({
            collection: changeLogCollection as never,
            data: {
                action: proposal.action,
                additions,
                after,
                aiResponse: context?.aiResponse,
                before,
                collection: "collection" in proposal ? proposal.collection : undefined,
                documentID: target.documentID === undefined ? undefined : String(target.documentID),
                inputTokens: context?.tokenUsage?.inputTokens,
                outputTokens: context?.tokenUsage?.outputTokens,
                prompt: context?.prompt,
                proposal: redactSensitiveData(proposalForLog),
                removals,
                slug: "slug" in proposal ? proposal.slug : undefined,
                totalTokens: context?.tokenUsage?.totalTokens,
                targetType: proposal.action === "updateGlobal" ? "global" : "collection",
                targetURL: getTargetURL({
                    documentID: target.documentID,
                    proposal,
                    req,
                }),
                title: proposal.label,
                userID: getUserID(req),
                userLabel: getUserLabel(req),
            },
            overrideAccess: true,
            req,
        })

        return {
            action: proposal.action,
            additions,
            after,
            aiResponse: context?.aiResponse || null,
            before,
            collection: "collection" in proposal ? proposal.collection : null,
            createdAt: new Date().toISOString(),
            documentID: target.documentID === undefined ? null : String(target.documentID),
            inputTokens: context?.tokenUsage?.inputTokens ?? null,
            outputTokens: context?.tokenUsage?.outputTokens ?? null,
            prompt: context?.prompt || null,
            removals,
            slug: "slug" in proposal ? proposal.slug : null,
            totalTokens: context?.tokenUsage?.totalTokens ?? null,
            targetType: proposal.action === "updateGlobal" ? "global" : "collection",
            title: proposal.label,
            userID: getUserID(req) || null,
            userLabel: getUserLabel(req),
            url: getTargetURL({
                documentID: target.documentID,
                proposal,
                req,
            }),
        }
    } catch (err) {
        req.payload.logger.error({
            err,
            msg: "AI change log entry could not be written",
            proposal: getProposalMeta(proposal),
        })

        return null
    }
}

export const createApplyActionHandler =
    (options: ApplyActionOptions = {}): PayloadHandler =>
    async (req) => {
        const failApply = ({
            debug,
            error,
            logMessage,
            proposal,
            status = 400,
        }: {
            debug: ApplyDebugPayload
            error: string
            logMessage: string
            proposal?: Partial<ActionProposal>
            status?: number
        }) => {
            logHandlerEvent(req, "warn", {
                debug,
                msg: logMessage,
                proposal: getProposalMeta(proposal),
            })

            return Response.json(
                {
                    debug,
                    error,
                },
                { status }
            )
        }

        if (!req.user) {
            return failApply({
                debug: createApplyDebugPayload({
                    phase: "authorization",
                    reason: "unauthorized",
                }),
                error: "Unauthorized",
                logMessage: "AI apply blocked: unauthorized request",
                status: 401,
            })
        }

        const body = req.json ? ((await req.json().catch(() => null)) as ApplyActionBody | null) : null

        const proposal = body?.proposal
        if (!proposal) {
            return failApply({
                debug: createApplyDebugPayload({
                    phase: "apply_validation",
                    reason: "missing_proposal",
                }),
                error: "Proposal is required",
                logMessage: "AI apply blocked: missing proposal payload",
            })
        }
        if (!verifyActionProposal(proposal)) {
            return failApply({
                debug: createApplyDebugPayload({
                    phase: "apply_validation",
                    proposal,
                    reason: "invalid_signature",
                }),
                error: "Proposal signature is invalid or expired.",
                logMessage: "AI apply blocked: invalid proposal signature",
                proposal,
            })
        }
        if (!isActionProposal(proposal)) {
            return failApply({
                debug: createApplyDebugPayload({
                    phase: "apply_validation",
                    proposal,
                    reason: "invalid_proposal_shape",
                }),
                error: "Proposal is invalid.",
                logMessage: "AI apply blocked: invalid proposal shape",
                proposal,
            })
        }
        if ("data" in proposal && proposal.data && containsSensitiveData(proposal.data)) {
            return failApply({
                debug: createApplyDebugPayload({
                    phase: "apply_validation",
                    proposal,
                    reason: "sensitive_data_in_data",
                }),
                error: "Proposal contains sensitive fields and cannot be applied.",
                logMessage: "AI apply blocked: sensitive data detected in proposal data",
                proposal,
            })
        }
        if (hasLocalizedData(proposal) && Object.values(proposal.localizedData).some((value) => containsSensitiveData(value))) {
            return failApply({
                debug: createApplyDebugPayload({
                    phase: "apply_validation",
                    proposal,
                    reason: "sensitive_data_in_localized_data",
                }),
                error: "Proposal contains sensitive fields and cannot be applied.",
                logMessage: "AI apply blocked: sensitive data detected in localized proposal data",
                proposal,
            })
        }

        const logContext: ApplyActionLogContext = {
            aiResponse: typeof body?.aiResponse === "string" && body.aiResponse.trim() ? body.aiResponse.trim() : undefined,
            prompt: typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : undefined,
            tokenUsage: body?.tokenUsage
                ? {
                      inputTokens: getOptionalNumber(body.tokenUsage.inputTokens),
                      outputTokens: getOptionalNumber(body.tokenUsage.outputTokens),
                      totalTokens: getOptionalNumber(body.tokenUsage.totalTokens),
                  }
                : undefined,
        }

        logHandlerEvent(req, "info", {
            msg: "AI apply started",
            promptPreview: getLogPreview(logContext.prompt),
            proposal: getProposalLogSummary(proposal),
            tokenUsage: logContext.tokenUsage,
        })

        try {
            const defaultLocale = getDefaultLocale(req)

            if (proposal.action === "updateGlobal") {
                if (!isKnownGlobal(req, proposal.slug)) {
                    return failApply({
                        debug: createApplyDebugPayload({
                            phase: "apply_validation",
                            proposal,
                            reason: "unknown_global",
                        }),
                        error: "Unknown global",
                        logMessage: "AI apply blocked: unknown global",
                        proposal,
                    })
                }

                const globalConfig = req.payload.config.globals?.find((global) => global.slug === proposal.slug)
                if (hasLocalizedData(proposal)) {
                    const beforeByLocale: Record<string, unknown> = {}
                    const afterByLocale: Record<string, unknown> = {}
                    const globalFields = getSchemaFields({
                        fields: (globalConfig?.fields || []) as FieldConfig[],
                        slug: proposal.slug,
                    })
                    const preparedData = prepareProposalWriteData({
                        collectionConfig: {
                            fields: (globalConfig?.fields || []) as FieldConfig[],
                            slug: proposal.slug,
                        },
                        label: proposal.label,
                        localizedData: proposal.localizedData,
                        mode: "update",
                    })

                    if (preparedData.issues.length > 0 || !preparedData.localizedData) {
                        return failApply({
                            debug: createApplyDebugPayload({
                                details: {
                                    issues: preparedData.issues,
                                },
                                phase: "apply_validation",
                                proposal,
                                reason: "invalid_global_write_shape",
                            }),
                            error: "Proposal is invalid.",
                            logMessage: "AI apply blocked: invalid global proposal data",
                            proposal,
                        })
                    }
                    const defaultLocaleDoc = defaultLocale
                        ? ((await req.payload.findGlobal({
                              depth: 2,
                              fallbackLocale: false,
                              locale: defaultLocale,
                              req,
                              slug: proposal.slug as never,
                          })) as Record<string, unknown>)
                        : null

                    for (const [locale, localeData] of Object.entries(preparedData.localizedData)) {
                        const before = (await req.payload.findGlobal({
                            depth: 2,
                            fallbackLocale: false,
                            locale,
                            req,
                            slug: proposal.slug as never,
                        })) as Record<string, unknown>
                        const completedData = applyLocalizedRequiredFallbackToPreparedData({
                            fallbackSource: locale === defaultLocale ? before : defaultLocaleDoc || before,
                            fields: globalFields,
                            preparedData: localeData,
                        })

                        await req.payload.updateGlobal({
                            data: completedData,
                            locale,
                            overrideAccess: false,
                            req,
                            slug: proposal.slug as never,
                        })

                        beforeByLocale[locale] = before
                        afterByLocale[locale] = mergeData(before, completedData)
                    }

                    const change = await logAIChange({
                        changeLogCollection: options.changeLogCollection,
                        context: logContext,
                        proposal,
                        req,
                        target: {
                            after: afterByLocale,
                            before: beforeByLocale,
                        },
                    })

                    logHandlerEvent(req, "info", {
                        changeLogged: Boolean(change),
                        locales: Object.keys(proposal.localizedData),
                        msg: "AI apply succeeded",
                        proposal: getProposalLogSummary(proposal),
                    })
                    return Response.json({
                        change,
                        doc: undefined,
                        status: "applied",
                    })
                }

                const preparedData = prepareProposalWriteData({
                    collectionConfig: {
                        fields: (globalConfig?.fields || []) as FieldConfig[],
                        slug: proposal.slug,
                    },
                    data: proposal.data,
                    label: proposal.label,
                    mode: "update",
                })
                if (preparedData.issues.length > 0 || !preparedData.data) {
                    return failApply({
                        debug: createApplyDebugPayload({
                            details: {
                                issues: preparedData.issues,
                            },
                            phase: "apply_validation",
                            proposal,
                            reason: "invalid_global_write_shape",
                        }),
                        error: "Proposal is invalid.",
                        logMessage: "AI apply blocked: invalid global proposal data",
                        proposal,
                    })
                }
                const before = (await req.payload.findGlobal({
                    depth: 2,
                    ...(proposal.locale ? { locale: proposal.locale } : {}),
                    req,
                    slug: proposal.slug as never,
                })) as Record<string, unknown>
                const doc = await req.payload.updateGlobal({
                    data: preparedData.data,
                    ...(proposal.locale ? { locale: proposal.locale } : {}),
                    overrideAccess: false,
                    req,
                    slug: proposal.slug as never,
                })
                const change = await logAIChange({
                    changeLogCollection: options.changeLogCollection,
                    context: logContext,
                    proposal,
                    req,
                    target: {
                        after: mergeData(before, preparedData.data),
                        before,
                    },
                })

                logHandlerEvent(req, "info", {
                    changeLogged: Boolean(change),
                    locale: proposal.locale,
                    msg: "AI apply succeeded",
                    proposal: getProposalLogSummary(proposal),
                })
                return Response.json({
                    change,
                    doc: getAppliedDocReference(doc),
                    status: "applied",
                })
            }

            if (!isAllowedCollection(req, proposal.collection, options.collections, proposal.action)) {
                return failApply({
                    debug: createApplyDebugPayload({
                        phase: "authorization",
                        proposal,
                        reason: "unknown_or_disallowed_collection",
                    }),
                    error: "Unknown collection",
                    logMessage: "AI apply blocked: unknown or disallowed collection",
                    proposal,
                })
            }

            if (proposal.action === "delete") {
                const doc = await req.payload.delete({
                    collection: proposal.collection as never,
                    id: proposal.id,
                    overrideAccess: false,
                    req,
                })
                const change = await logAIChange({
                    changeLogCollection: options.changeLogCollection,
                    context: logContext,
                    proposal,
                    req,
                    target: {
                        after: {},
                        before: doc,
                        documentID: proposal.id,
                    },
                })

                logHandlerEvent(req, "info", {
                    changeLogged: Boolean(change),
                    documentID: proposal.id,
                    msg: "AI apply succeeded",
                    proposal: getProposalLogSummary(proposal),
                })
                return Response.json({
                    change,
                    doc: getAppliedDocReference(doc),
                    status: "applied",
                })
            }

            const collectionConfig = req.payload.config.collections.find((collection) => collection.slug === proposal.collection) as
                | CollectionConfig
                | undefined
            const collectionFields = getSchemaFields(collectionConfig)

            if (hasLocalizedData(proposal)) {
                const preparedData = prepareProposalWriteData({
                    collectionConfig,
                    label: proposal.label,
                    localizedData: proposal.localizedData,
                    mode: proposal.action,
                })

                if (preparedData.issues.length > 0 || !preparedData.localizedData) {
                    return failApply({
                        debug: createApplyDebugPayload({
                            details: {
                                issues: preparedData.issues,
                            },
                            phase: "apply_validation",
                            proposal,
                            reason: "invalid_collection_write_shape",
                        }),
                        error: "Proposal is invalid.",
                        logMessage: "AI apply blocked: invalid collection proposal data",
                        proposal,
                    })
                }

                if (proposal.action === "create") {
                    const localeEntries = Object.entries(preparedData.localizedData)
                    const [firstLocale, firstLocaleData] = localeEntries[0] || []

                    if (!firstLocale) {
                        return failApply({
                            debug: createApplyDebugPayload({
                                phase: "apply_validation",
                                proposal,
                                reason: "localized_create_without_locales",
                            }),
                            error: "Proposal is invalid.",
                            logMessage: "AI apply blocked: localized create proposal has no locales",
                            proposal,
                        })
                    }

                    const doc = await req.payload.create({
                        collection: proposal.collection as never,
                        data: firstLocaleData,
                        locale: firstLocale,
                        overrideAccess: false,
                        req,
                    })
                    const beforeByLocale: Record<string, unknown> = {
                        [firstLocale]: {},
                    }
                    const afterByLocale: Record<string, unknown> = {
                        [firstLocale]: doc,
                    }
                    let fallbackSource = doc as Record<string, unknown>

                    for (const [locale, localeData] of localeEntries.slice(1)) {
                        const completedData = applyLocalizedRequiredFallbackToPreparedData({
                            fallbackSource,
                            fields: collectionFields,
                            preparedData: localeData,
                        })
                        await req.payload.update({
                            collection: proposal.collection as never,
                            data: completedData,
                            id: String(doc.id),
                            locale,
                            overrideAccess: false,
                            req,
                        })

                        beforeByLocale[locale] = {}
                        afterByLocale[locale] = completedData
                    }

                    const change = await logAIChange({
                        changeLogCollection: options.changeLogCollection,
                        context: logContext,
                        proposal,
                        req,
                        target: {
                            after: afterByLocale,
                            before: beforeByLocale,
                            documentID: doc.id,
                        },
                    })

                    logHandlerEvent(req, "info", {
                        changeLogged: Boolean(change),
                        documentID: doc.id,
                        locales: localeEntries.map(([locale]) => locale),
                        msg: "AI apply succeeded",
                        proposal: getProposalLogSummary(proposal),
                    })
                    return Response.json({
                        change,
                        doc: getAppliedDocReference(doc),
                        status: "applied",
                    })
                }

                const beforeByLocale: Record<string, unknown> = {}
                const afterByLocale: Record<string, unknown> = {}
                const defaultLocaleDoc = defaultLocale
                    ? ((await req.payload.findByID({
                          collection: proposal.collection as never,
                          depth: 2,
                          fallbackLocale: false,
                          id: proposal.id,
                          locale: defaultLocale,
                          req,
                      })) as Record<string, unknown>)
                    : null

                for (const [locale, localeData] of Object.entries(preparedData.localizedData)) {
                    const before = (await req.payload.findByID({
                        collection: proposal.collection as never,
                        depth: 2,
                        fallbackLocale: false,
                        id: proposal.id,
                        locale,
                        req,
                    })) as Record<string, unknown>
                    const completedData = applyLocalizedRequiredFallbackToPreparedData({
                        fallbackSource: locale === defaultLocale ? before : defaultLocaleDoc || before,
                        fields: collectionFields,
                        preparedData: localeData,
                    })

                    await req.payload.update({
                        collection: proposal.collection as never,
                        data: completedData,
                        id: proposal.id,
                        locale,
                        overrideAccess: false,
                        req,
                    })

                    beforeByLocale[locale] = before
                    afterByLocale[locale] = mergeData(before, completedData)
                }

                const change = await logAIChange({
                    changeLogCollection: options.changeLogCollection,
                    context: logContext,
                    proposal,
                    req,
                    target: {
                        after: afterByLocale,
                        before: beforeByLocale,
                        documentID: proposal.id,
                    },
                })

                logHandlerEvent(req, "info", {
                    changeLogged: Boolean(change),
                    documentID: proposal.id,
                    locales: Object.keys(proposal.localizedData),
                    msg: "AI apply succeeded",
                    proposal: getProposalLogSummary(proposal),
                })
                return Response.json({
                    change,
                    doc: {
                        id: proposal.id,
                    },
                    status: "applied",
                })
            }

            const preparedData = prepareProposalWriteData({
                collectionConfig,
                data: proposal.data,
                label: proposal.label,
                mode: proposal.action,
            })

            if (preparedData.issues.length > 0 || !preparedData.data) {
                return failApply({
                    debug: createApplyDebugPayload({
                        details: {
                            issues: preparedData.issues,
                        },
                        phase: "apply_validation",
                        proposal,
                        reason: "invalid_collection_write_shape",
                    }),
                    error: "Proposal is invalid.",
                    logMessage: "AI apply blocked: invalid collection proposal data",
                    proposal,
                })
            }

            if (proposal.action === "create") {
                const doc = await req.payload.create({
                    collection: proposal.collection as never,
                    data: preparedData.data,
                    ...(proposal.locale ? { locale: proposal.locale } : {}),
                    overrideAccess: false,
                    req,
                })
                const change = await logAIChange({
                    changeLogCollection: options.changeLogCollection,
                    context: logContext,
                    proposal,
                    req,
                    target: {
                        after: doc,
                        before: {},
                        documentID: doc.id,
                    },
                })

                logHandlerEvent(req, "info", {
                    changeLogged: Boolean(change),
                    documentID: doc.id,
                    msg: "AI apply succeeded",
                    proposal: getProposalLogSummary(proposal),
                })
                return Response.json({
                    change,
                    doc: getAppliedDocReference(doc),
                    status: "applied",
                })
            }

            const before = (await req.payload.findByID({
                collection: proposal.collection as never,
                depth: 2,
                id: proposal.id,
                ...(proposal.locale ? { locale: proposal.locale } : {}),
                req,
            })) as Record<string, unknown>
            const doc = await req.payload.update({
                collection: proposal.collection as never,
                data: preparedData.data,
                id: proposal.id,
                ...(proposal.locale ? { locale: proposal.locale } : {}),
                overrideAccess: false,
                req,
            })
            const change = await logAIChange({
                changeLogCollection: options.changeLogCollection,
                context: logContext,
                proposal,
                req,
                target: {
                    after: mergeData(before, preparedData.data),
                    before,
                    documentID: proposal.id,
                },
            })

            logHandlerEvent(req, "info", {
                changeLogged: Boolean(change),
                documentID: proposal.id,
                msg: "AI apply succeeded",
                proposal: getProposalLogSummary(proposal),
            })
            return Response.json({
                change,
                doc: getAppliedDocReference(doc),
                status: "applied",
            })
        } catch (err) {
            const debug = createApplyDebugPayload({
                details:
                    err && typeof err === "object" && "data" in err && isRecord((err as { data?: unknown }).data)
                        ? ({ payloadError: (err as { data: Record<string, unknown> }).data } as Record<string, unknown>)
                        : undefined,
                phase: "payload_operation",
                proposal,
                reason: "payload_operation_failed",
            })
            req.payload.logger.error({
                debug,
                err,
                msg: "AI apply action failed",
                promptPreview: getLogPreview(logContext.prompt),
                proposal: getProposalMeta(proposal),
                tokenUsage: logContext.tokenUsage,
            })

            return Response.json(
                {
                    debug,
                    error: "Could not apply proposal.",
                },
                { status: 400 }
            )
        }
    }

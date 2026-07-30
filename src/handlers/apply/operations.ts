import type { PayloadHandler } from "payload"

import type { ActionProposal } from "../../features/proposals/types.js"
import { type CollectionConfig, type FieldConfig, getSchemaFields } from "../../features/schema/normalize.js"
import { applyLocalizedRequiredFallbackToPreparedData, prepareProposalWriteData } from "../../features/proposals/data.js"
import { isCollectionActionAllowed, type CollectionAction } from "../../features/collectionPermissions.js"
import { getDefaultLocale, hasLocalizedData, isKnownGlobal, mergeData } from "../../utils/data.js"
import { logHandlerEvent } from "../../utils/logging.js"
import { getAppliedDocReference, logAIChange } from "./audit.js"
import type { ApplyActionLogContext, ApplyActionOptions, ApplyDebugPayload } from "./types.js"
import { createApplyDebugPayload, getProposalLogSummary } from "./validation.js"

type FailApply = (failure: {
    debug: ApplyDebugPayload
    error: string
    logMessage: string
    proposal?: Partial<ActionProposal>
    status?: number
}) => Response

const isAllowedCollection = (
    req: Parameters<PayloadHandler>[0],
    collection: string,
    collections?: ApplyActionOptions["collections"],
    action: CollectionAction = "read"
) =>
    isCollectionActionAllowed({
        action,
        permissions: collections,
        req,
        slug: collection,
    })

export const applyActionProposal = async ({
    failApply,
    logContext,
    options,
    proposal,
    req,
}: {
    failApply: FailApply
    logContext: ApplyActionLogContext
    options: ApplyActionOptions
    proposal: ActionProposal
    req: Parameters<PayloadHandler>[0]
}): Promise<Response> => {
    const inferenceText = logContext.prompt
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
                inferenceText,
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
    
            const localizedResults = await Promise.all(
                Object.entries(preparedData.localizedData).map(async ([locale, localeData]) => {
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
    
                    return { before, completedData, locale }
                })
            )
    
            localizedResults.forEach(({ before, completedData, locale }) => {
                beforeByLocale[locale] = before
                afterByLocale[locale] = mergeData(before, completedData)
            })
    
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
            inferenceText,
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
            inferenceText,
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
            const fallbackSource = doc as Record<string, unknown>
            const localizedResults = await Promise.all(
                localeEntries.slice(1).map(async ([locale, localeData]) => {
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
    
                    return { completedData, locale }
                })
            )
    
            localizedResults.forEach(({ completedData, locale }) => {
                beforeByLocale[locale] = {}
                afterByLocale[locale] = completedData
            })
    
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
    
        const localizedResults = await Promise.all(
            Object.entries(preparedData.localizedData).map(async ([locale, localeData]) => {
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
    
                return { before, completedData, locale }
            })
        )
    
        localizedResults.forEach(({ before, completedData, locale }) => {
            beforeByLocale[locale] = before
            afterByLocale[locale] = mergeData(before, completedData)
        })
    
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
        inferenceText,
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
    
}

import type { PayloadHandler } from "payload"

import type { ActionProposal } from "../../features/proposals/types.js"
import { prepareLocalizedTargetUpdates, prepareProposalTargetData, resolveProposalTarget } from "../../features/proposals/target.js"
import { applyLocalizedRequiredFallbackToPreparedData } from "../../features/proposals/data.js"
import { isCollectionActionAllowed, type CollectionAction } from "../../features/collectionPermissions.js"
import { getDefaultLocale, hasLocalizedData, mergeData } from "../../utils/data.js"
import { logHandlerEvent } from "../../utils/logging.js"
import { getAppliedDocReference, logAIChange } from "./audit.js"
import type { ApplyActionLogContext, ApplyActionOptions, ApplyDebugPayload } from "./types.js"
import { createApplyDebugPayload, getProposalLogSummary } from "./validation.js"

type FailApply = (failure: { debug: ApplyDebugPayload; error: string; logMessage: string; proposal?: Partial<ActionProposal>; status?: number }) => Response

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
    const target = resolveProposalTarget({ proposal, req })

    if (proposal.action === "updateGlobal") {
        if (!target || target.type !== "global") {
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

        if (hasLocalizedData(proposal)) {
            const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })

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
            const localizedResults = await prepareLocalizedTargetUpdates({
                defaultLocale: defaultLocale || undefined,
                localizedData: preparedData.localizedData,
                target,
            })
            await Promise.all(localizedResults.map(({ data, locale }) => target.update(data, locale)))

            const change = await logAIChange({
                changeLogCollection: options.changeLogCollection,
                context: logContext,
                proposal,
                req,
                target: {
                    after: Object.fromEntries(localizedResults.map(({ after, locale }) => [locale, after])),
                    before: Object.fromEntries(localizedResults.map(({ before, locale }) => [locale, before])),
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

        const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })
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
        const before = await target.read({ locale: proposal.locale })
        const doc = await target.update(preparedData.data, proposal.locale)
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

    if (!target || target.type !== "collection") {
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
        const doc = await target.delete()
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

    if (hasLocalizedData(proposal)) {
        const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })

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

            const doc = await target.create(firstLocaleData, firstLocale)
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
                        fields: target.fields,
                        preparedData: localeData,
                    })
                    await target.update(completedData, locale, String(doc.id))

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

        const localizedResults = await prepareLocalizedTargetUpdates({
            defaultLocale: defaultLocale || undefined,
            localizedData: preparedData.localizedData,
            target,
        })
        await Promise.all(localizedResults.map(({ data, locale }) => target.update(data, locale)))

        const change = await logAIChange({
            changeLogCollection: options.changeLogCollection,
            context: logContext,
            proposal,
            req,
            target: {
                after: Object.fromEntries(localizedResults.map(({ after, locale }) => [locale, after])),
                before: Object.fromEntries(localizedResults.map(({ before, locale }) => [locale, before])),
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

    const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })

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
        const doc = await target.create(preparedData.data, proposal.locale)
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

    const before = await target.read({ locale: proposal.locale })
    const doc = await target.update(preparedData.data, proposal.locale)
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

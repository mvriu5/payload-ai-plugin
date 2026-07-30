import type { PayloadHandler } from "payload"

import { redactSensitiveData } from "../features/sensitiveData.js"
import { validateSignedProposal } from "../features/proposals/validation.js"
import { prepareLocalizedTargetUpdates, prepareProposalTargetData, resolveProposalTarget } from "../features/proposals/target.js"
import { applyLocalizedRequiredFallbackToPreparedData } from "../features/proposals/data.js"
import { isCollectionActionAllowed, type ResolvedCollectionPermissionMap } from "../features/collectionPermissions.js"
import { getDefaultLocale, hasLocalizedData, mergeData } from "../utils/data.js"
import { jsonError, logHandlerError, readJSONBody, withAuthenticatedHandler } from "./http.js"

type ProposalDiffBody = {
    prompt?: string
    proposal?: unknown
}

type ProposalDiffOptions = {
    collections?: ResolvedCollectionPermissionMap
}

export const createProposalDiffHandler = (options: ProposalDiffOptions = {}): PayloadHandler =>
    withAuthenticatedHandler(async (req) => {
        const body = await readJSONBody<ProposalDiffBody>(req)
        const proposalValidation = validateSignedProposal(body?.proposal)
        if (!proposalValidation.ok) {
            if (proposalValidation.error === "missing") return jsonError("Proposal is required")
            if (proposalValidation.error === "invalid_signature") return jsonError("Proposal signature is invalid or expired.")
            return jsonError("Proposal is invalid.")
        }
        const proposal = proposalValidation.proposal

        try {
            const inferenceText = body?.prompt
            const defaultLocale = getDefaultLocale(req)
            const target = resolveProposalTarget({ proposal, req })

            if (proposal.action === "updateGlobal") {
                if (!target || target.type !== "global") return jsonError("Unknown global")

                if (hasLocalizedData(proposal)) {
                    const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })
                    if (preparedData.issues.length > 0 || !preparedData.localizedData) {
                        return jsonError("Proposal is invalid.")
                    }
                    const localizedResults = await prepareLocalizedTargetUpdates({
                        defaultLocale: defaultLocale || undefined,
                        localizedData: preparedData.localizedData,
                        target,
                    })

                    return Response.json({
                        after: Object.fromEntries(localizedResults.map(({ after, locale }) => [locale, redactSensitiveData(after)])),
                        before: Object.fromEntries(localizedResults.map(({ before, locale }) => [locale, redactSensitiveData(before)])),
                    })
                }

                const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })
                if (preparedData.issues.length > 0 || !preparedData.data) {
                    return jsonError("Proposal is invalid.")
                }
                const doc = await target.read({ locale: proposal.locale })

                return Response.json({
                    after: redactSensitiveData(mergeData(doc, preparedData.data)),
                    before: redactSensitiveData(doc),
                })
            }

            if (
                !isCollectionActionAllowed({
                    action: proposal.action === "delete" ? "delete" : "read",
                    permissions: options.collections,
                    req,
                    slug: proposal.collection,
                })
            )
                return jsonError("Unknown collection")

            if (!target || target.type !== "collection") return jsonError("Unknown collection")

            if (proposal.action === "delete") {
                const doc = await target.read({ locale: proposal.locale })

                return Response.json({
                    after: {},
                    before: redactSensitiveData(doc),
                })
            }

            if (hasLocalizedData(proposal)) {
                const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })
                if (preparedData.issues.length > 0 || !preparedData.localizedData) {
                    return jsonError("Proposal is invalid.")
                }
                const afterByLocale: Record<string, unknown> = {}
                const beforeByLocale: Record<string, unknown> = {}
                let createFallbackSource: Record<string, unknown> | null = null

                if (proposal.action === "create") {
                    for (const [locale, localeData] of Object.entries(preparedData.localizedData)) {
                        const completedData = applyLocalizedRequiredFallbackToPreparedData({
                            fallbackSource: createFallbackSource || {},
                            fields: target.fields,
                            preparedData: localeData,
                        })

                        beforeByLocale[locale] = {}
                        afterByLocale[locale] = redactSensitiveData(completedData)
                        createFallbackSource = mergeData(createFallbackSource || {}, completedData)
                    }
                } else {
                    const localizedResults = await prepareLocalizedTargetUpdates({
                        defaultLocale: defaultLocale || undefined,
                        localizedData: preparedData.localizedData,
                        target,
                    })

                    localizedResults.forEach(({ after, before, locale }) => {
                        beforeByLocale[locale] = redactSensitiveData(before)
                        afterByLocale[locale] = redactSensitiveData(after)
                    })
                }

                return Response.json({
                    after: afterByLocale,
                    before: beforeByLocale,
                })
            }

            const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })
            if (preparedData.issues.length > 0 || !preparedData.data) {
                return jsonError("Proposal is invalid.")
            }

            if (proposal.action === "create") {
                return Response.json({
                    after: redactSensitiveData(preparedData.data),
                    before: {},
                })
            }

            const doc = await target.read({ locale: proposal.locale })

            return Response.json({
                after: redactSensitiveData(mergeData(doc, preparedData.data)),
                before: redactSensitiveData(doc),
            })
        } catch (err) {
            return logHandlerError({
                error: err,
                logMessage: "AI proposal diff failed",
                publicMessage: "Could not load proposal diff.",
                req,
                status: 400,
            })
        }
    })

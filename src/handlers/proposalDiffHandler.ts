import type { PayloadHandler } from "payload"

import { redactSensitiveData } from "../features/sensitiveData.js"
import type { ActionProposal } from "../features/proposals/types.js"
import { verifyActionProposal } from "../features/proposals/signing.js"
import { prepareLocalizedTargetUpdates, prepareProposalTargetData, resolveProposalTarget } from "../features/proposals/target.js"
import { applyLocalizedRequiredFallbackToPreparedData } from "../features/proposals/data.js"
import { isCollectionActionAllowed, type ResolvedCollectionPermissionMap } from "../features/collectionPermissions.js"
import { getDefaultLocale, hasLocalizedData, isActionProposal, mergeData } from "../utils/data.js"

type ProposalDiffBody = {
    prompt?: string
    proposal?: ActionProposal
}

type ProposalDiffOptions = {
    collections?: ResolvedCollectionPermissionMap
}

export const createProposalDiffHandler =
    (options: ProposalDiffOptions = {}): PayloadHandler =>
    async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

        const body = req.json ? ((await req.json().catch(() => null)) as ProposalDiffBody | null) : null

        const proposal = body?.proposal
        if (!proposal) return Response.json({ error: "Proposal is required" }, { status: 400 })
        if (!verifyActionProposal(proposal)) return Response.json({ error: "Proposal signature is invalid or expired." }, { status: 400 })
        if (!isActionProposal(proposal)) return Response.json({ error: "Proposal is invalid." }, { status: 400 })

        try {
            const inferenceText = body?.prompt
            const defaultLocale = getDefaultLocale(req)
            const target = resolveProposalTarget({ proposal, req })

            if (proposal.action === "updateGlobal") {
                if (!target || target.type !== "global") return Response.json({ error: "Unknown global" }, { status: 400 })

                if (hasLocalizedData(proposal)) {
                    const preparedData = prepareProposalTargetData({ inferenceText, proposal, target })
                    if (preparedData.issues.length > 0 || !preparedData.localizedData) {
                        return Response.json({ error: "Proposal is invalid." }, { status: 400 })
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
                    return Response.json({ error: "Proposal is invalid." }, { status: 400 })
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
                return Response.json({ error: "Unknown collection" }, { status: 400 })

            if (!target || target.type !== "collection") return Response.json({ error: "Unknown collection" }, { status: 400 })

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
                    return Response.json({ error: "Proposal is invalid." }, { status: 400 })
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
                return Response.json({ error: "Proposal is invalid." }, { status: 400 })
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
            req.payload.logger.error({
                err,
                msg: "AI proposal diff failed",
            })

            return Response.json(
                {
                    error: "Could not load proposal diff.",
                },
                { status: 400 }
            )
        }
    }

import type { PayloadHandler } from "payload"

import { verifyActionProposal } from "../ai/proposalSigning.js"
import { redactSensitiveData } from "../ai/sensitiveData.js"
import {
    getCollectionFields,
    getLocalizedRequiredFallbackData,
    normalizeAuthData,
    normalizeDataForFields,
    type CollectionConfig,
    type FieldConfig,
} from "../payload/normalizeData.js"
import { isCollectionActionAllowed, type ResolvedCollectionPermissionMap } from "../payload/collectionPermissions.js"
import { getDefaultLocale, hasLocalizedData, isActionProposal, mergeData } from "../payload/shared.js"
import type { ActionProposal } from "./chatHandler.js"

type ProposalDiffBody = {
    proposal?: ActionProposal
}

type ProposalDiffOptions = {
    collections?: ResolvedCollectionPermissionMap
}

const applyLocalizedRequiredFallback = ({
    data,
    fallbackSource,
    fields,
}: {
    data: Record<string, unknown>
    fallbackSource: Record<string, unknown>
    fields: FieldConfig[]
}) => {
    return mergeData(
        getLocalizedRequiredFallbackData({
            fields,
            source: fallbackSource,
            target: data,
        }),
        data
    )
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
            const defaultLocale = getDefaultLocale(req)

            if (proposal.action === "updateGlobal") {
                const globalConfig = req.payload.config.globals?.find((global) => global.slug === proposal.slug)
                if (!globalConfig) return Response.json({ error: "Unknown global" }, { status: 400 })

                if (hasLocalizedData(proposal)) {
                    const beforeByLocale: Record<string, unknown> = {}
                    const afterByLocale: Record<string, unknown> = {}
                    const globalFields = (globalConfig.fields || []) as FieldConfig[]
                    const defaultLocaleDoc = defaultLocale
                        ? ((await req.payload.findGlobal({
                              depth: 2,
                              fallbackLocale: false,
                              locale: defaultLocale,
                              overrideAccess: false,
                              req,
                              slug: proposal.slug as never,
                          })) as Record<string, unknown>)
                        : null

                    for (const [locale, localeData] of Object.entries(proposal.localizedData)) {
                        const normalized = normalizeDataForFields(globalFields, localeData)
                        const doc = (await req.payload.findGlobal({
                            depth: 2,
                            fallbackLocale: false,
                            locale,
                            overrideAccess: false,
                            req,
                            slug: proposal.slug as never,
                        })) as Record<string, unknown>
                        const completedData = applyLocalizedRequiredFallback({
                            data: normalized.data,
                            fallbackSource: locale === defaultLocale ? doc : defaultLocaleDoc || doc,
                            fields: globalFields,
                        })

                        beforeByLocale[locale] = redactSensitiveData(doc)
                        afterByLocale[locale] = redactSensitiveData(mergeData(doc, completedData))
                    }

                    return Response.json({
                        after: afterByLocale,
                        before: beforeByLocale,
                    })
                }

                const normalized = normalizeDataForFields((globalConfig.fields || []) as FieldConfig[], proposal.data)
                const doc = (await req.payload.findGlobal({
                    depth: 2,
                    ...(proposal.locale ? { locale: proposal.locale } : {}),
                    overrideAccess: false,
                    req,
                    slug: proposal.slug as never,
                })) as Record<string, unknown>

                return Response.json({
                    after: redactSensitiveData(mergeData(doc, normalized.data)),
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

            if (proposal.action === "delete") {
                const doc = await req.payload.findByID({
                    collection: proposal.collection as never,
                    depth: 2,
                    id: proposal.id,
                    ...(proposal.locale ? { locale: proposal.locale } : {}),
                    overrideAccess: false,
                    req,
                })

                return Response.json({
                    after: {},
                    before: redactSensitiveData(doc),
                })
            }

            const collectionConfig = req.payload.config.collections.find((collection) => collection.slug === proposal.collection) as
                | CollectionConfig
                | undefined
            const collectionFields = getCollectionFields(collectionConfig)
            const normalizeCollectionData = (data: Record<string, unknown>) =>
                normalizeAuthData(collectionConfig, normalizeDataForFields(collectionFields, data))

            if (hasLocalizedData(proposal)) {
                const afterByLocale: Record<string, unknown> = {}
                const beforeByLocale: Record<string, unknown> = {}
                const defaultLocaleDoc =
                    proposal.action === "update" && defaultLocale
                        ? ((await req.payload.findByID({
                              collection: proposal.collection as never,
                              depth: 2,
                              fallbackLocale: false,
                              id: proposal.id,
                              locale: defaultLocale,
                              overrideAccess: false,
                              req,
                          })) as Record<string, unknown>)
                        : null
                let createFallbackSource: Record<string, unknown> | null = null

                for (const [locale, localeData] of Object.entries(proposal.localizedData)) {
                    const normalized = normalizeCollectionData(localeData)
                    const fallbackSource =
                        proposal.action === "create"
                            ? createFallbackSource || {}
                            : locale === defaultLocale
                              ? ((await req.payload.findByID({
                                    collection: proposal.collection as never,
                                    depth: 2,
                                    fallbackLocale: false,
                                    id: proposal.id,
                                    locale,
                                    overrideAccess: false,
                                    req,
                                })) as Record<string, unknown>)
                              : defaultLocaleDoc || {}
                    const completedData = applyLocalizedRequiredFallback({
                        data: normalized.data,
                        fallbackSource,
                        fields: collectionFields,
                    })

                    if (proposal.action === "create") {
                        beforeByLocale[locale] = {}
                        afterByLocale[locale] = redactSensitiveData(completedData)
                        createFallbackSource = mergeData(createFallbackSource || {}, completedData)
                        continue
                    }

                    const doc = (await req.payload.findByID({
                        collection: proposal.collection as never,
                        depth: 2,
                        fallbackLocale: false,
                        id: proposal.id,
                        locale,
                        overrideAccess: false,
                        req,
                    })) as Record<string, unknown>

                    beforeByLocale[locale] = redactSensitiveData(doc)
                    afterByLocale[locale] = redactSensitiveData(mergeData(doc, completedData))
                }

                return Response.json({
                    after: afterByLocale,
                    before: beforeByLocale,
                })
            }

            const normalized = normalizeCollectionData(proposal.data)

            if (proposal.action === "create") {
                return Response.json({
                    after: redactSensitiveData(normalized.data),
                    before: {},
                })
            }

            const doc = (await req.payload.findByID({
                collection: proposal.collection as never,
                depth: 2,
                id: proposal.id,
                ...(proposal.locale ? { locale: proposal.locale } : {}),
                overrideAccess: false,
                req,
            })) as Record<string, unknown>

            return Response.json({
                after: redactSensitiveData(mergeData(doc, normalized.data)),
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

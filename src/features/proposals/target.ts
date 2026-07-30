import type { PayloadHandler } from "payload"

import type { CollectionConfig, FieldConfig } from "../schema/normalize.js"
import { getSchemaFields } from "../schema/normalize.js"
import { applyLocalizedRequiredFallbackToPreparedData, prepareProposalWriteData, type PreparedProposalData } from "./data.js"
import type { ActionProposal, LocalizedDataInput } from "./types.js"
import { mergeData } from "../../utils/data.js"

type Request = Parameters<PayloadHandler>[0]
type WriteProposal = Exclude<ActionProposal, { action: "delete" }>

type ReadOptions = {
    fallbackLocale?: false
    locale?: string
}

type BaseProposalTarget = {
    fields: FieldConfig[]
    read: (options?: ReadOptions) => Promise<Record<string, unknown>>
    schema: CollectionConfig
    update: (data: Record<string, unknown>, locale?: string, documentID?: string) => Promise<Record<string, unknown>>
}

export type CollectionProposalTarget = BaseProposalTarget & {
    collection: string
    create: (data: Record<string, unknown>, locale?: string) => Promise<Record<string, unknown>>
    delete: () => Promise<Record<string, unknown>>
    documentID?: string
    type: "collection"
}

export type GlobalProposalTarget = BaseProposalTarget & {
    slug: string
    type: "global"
}

export type ProposalTarget = CollectionProposalTarget | GlobalProposalTarget

const getLocaleOptions = ({ fallbackLocale, locale }: ReadOptions = {}) => ({
    ...(fallbackLocale === false ? { fallbackLocale: false as const } : {}),
    ...(locale ? { locale } : {}),
})

export const resolveProposalTarget = ({ proposal, req }: { proposal: ActionProposal; req: Request }): ProposalTarget | null => {
    if (proposal.action === "updateGlobal") {
        const config = req.payload.config.globals?.find((global) => global.slug === proposal.slug)
        if (!config) return null

        const schema = {
            fields: (config.fields || []) as FieldConfig[],
            slug: proposal.slug,
        }

        return {
            fields: getSchemaFields(schema),
            read: async (options) =>
                (await req.payload.findGlobal({
                    depth: 2,
                    ...getLocaleOptions(options),
                    overrideAccess: false,
                    req,
                    slug: proposal.slug as never,
                })) as Record<string, unknown>,
            schema,
            slug: proposal.slug,
            type: "global",
            update: async (data, locale) =>
                (await req.payload.updateGlobal({
                    data,
                    ...(locale ? { locale } : {}),
                    overrideAccess: false,
                    req,
                    slug: proposal.slug as never,
                })) as Record<string, unknown>,
        }
    }

    const config = req.payload.config.collections.find((collection) => collection.slug === proposal.collection) as CollectionConfig | undefined
    if (!config) return null

    const documentID = proposal.action === "create" ? undefined : proposal.id
    const requireDocumentID = (overrideDocumentID?: string) => {
        const resolvedDocumentID = overrideDocumentID || documentID
        if (!resolvedDocumentID) throw new Error(`Proposal target ${proposal.collection} requires a document id.`)
        return resolvedDocumentID
    }

    return {
        collection: proposal.collection,
        create: async (data, locale) =>
            (await req.payload.create({
                collection: proposal.collection as never,
                data,
                ...(locale ? { locale } : {}),
                overrideAccess: false,
                req,
            })) as Record<string, unknown>,
        delete: async () =>
            (await req.payload.delete({
                collection: proposal.collection as never,
                id: requireDocumentID(),
                overrideAccess: false,
                req,
            })) as Record<string, unknown>,
        documentID,
        fields: getSchemaFields(config),
        read: async (options) =>
            (await req.payload.findByID({
                collection: proposal.collection as never,
                depth: 2,
                id: requireDocumentID(),
                ...getLocaleOptions(options),
                overrideAccess: false,
                req,
            })) as Record<string, unknown>,
        schema: config,
        type: "collection",
        update: async (data, locale, updateDocumentID) =>
            (await req.payload.update({
                collection: proposal.collection as never,
                data,
                id: requireDocumentID(updateDocumentID),
                ...(locale ? { locale } : {}),
                overrideAccess: false,
                req,
            })) as Record<string, unknown>,
    }
}

export const prepareProposalTargetData = ({
    inferenceText,
    proposal,
    target,
}: {
    inferenceText?: string
    proposal: WriteProposal
    target: ProposalTarget
}): PreparedProposalData =>
    prepareProposalWriteData({
        collectionConfig: target.schema,
        ...("localizedData" in proposal ? { localizedData: proposal.localizedData } : { data: proposal.data }),
        inferenceText,
        label: proposal.label,
        mode: proposal.action === "create" ? "create" : "update",
    })

export const prepareLocalizedTargetUpdates = async ({
    defaultLocale,
    localizedData,
    target,
}: {
    defaultLocale?: string
    localizedData: LocalizedDataInput
    target: ProposalTarget
}) => {
    const defaultLocaleDoc = defaultLocale ? await target.read({ fallbackLocale: false, locale: defaultLocale }) : null

    return Promise.all(
        Object.entries(localizedData).map(async ([locale, localeData]) => {
            const before = locale === defaultLocale && defaultLocaleDoc ? defaultLocaleDoc : await target.read({ fallbackLocale: false, locale })
            const completedData = applyLocalizedRequiredFallbackToPreparedData({
                fallbackSource: locale === defaultLocale ? before : defaultLocaleDoc || before,
                fields: target.fields,
                preparedData: localeData,
            })

            return {
                after: mergeData(before, completedData),
                before,
                data: completedData,
                locale,
            }
        })
    )
}

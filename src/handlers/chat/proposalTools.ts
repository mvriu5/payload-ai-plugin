import type { PayloadHandler } from "payload"

import type { ActionProposal, LocalizedDataInput } from "../../features/proposals/types.js"
import type { FieldConfig as ProposalFieldConfig } from "../../features/schema/normalize.js"
import type { ChatMention, FieldConfig } from "../../features/schema/context.js"
import { getOptionValue, getSafeProposalLabel, hasValueAtPath, isRecord, setValueAtPath } from "../../utils/data.js"

type RequiredFieldInfo = {
    defaultValue?: unknown
    isTitleField?: boolean
    localized: boolean
    options?: (string | { label?: unknown; value?: string })[]
    path: string
    type?: string
}

export type BlockFieldConfig = ProposalFieldConfig & {
    blocks?: Array<{
        fields?: ProposalFieldConfig[]
        slug: string
    }>
    fields?: ProposalFieldConfig[]
    name?: string
    type?: string
}

type RelationshipTargetReference = {
    collection: string
    id: number | string
    path: string
}

export const getRequiredFieldInfos = (fields: FieldConfig[], titleFieldName?: string, path = ""): RequiredFieldInfo[] => {
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

export const fillMissingCreateFields = ({
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

export const getMissingCreateFields = ({
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
        const localizedRequiredFields: typeof requiredFields = []
        const sharedRequiredFields: typeof requiredFields = []

        for (const field of requiredFields) {
            if (field.localized) {
                localizedRequiredFields.push(field)
            } else {
                sharedRequiredFields.push(field)
            }
        }

        for (const [locale, localeData] of locales) {
            for (const field of localizedRequiredFields) {
                if (!hasValueAtPath(localeData, field.path)) {
                    missing.push(`${locale}:${field.path}`)
                }
            }
        }

        for (const field of sharedRequiredFields) {
            if (!hasValueAtPath(firstLocale[1], field.path)) {
                missing.push(`${firstLocale[0]}:${field.path}`)
            }
        }

        return missing
    }

    if (!data) return ["data is required"]

    return requiredFields.flatMap((field) => (hasValueAtPath(data, field.path) ? [] : [field.path]))
}

export const getProposalSummary = (proposal: ActionProposal) => ({
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

export const getCollectionBlockTypes = (fields: readonly BlockFieldConfig[]): string[] => {
    const blockTypes = new Set<string>()

    const visitFields = (items: readonly BlockFieldConfig[]) => {
        for (const field of items) {
            if (field.type === "blocks" && field.blocks) {
                for (const block of field.blocks) {
                    blockTypes.add(block.slug)
                    if (block.fields?.length) {
                        visitFields(block.fields as BlockFieldConfig[])
                    }
                }
            }

            if (field.fields?.length) {
                visitFields(field.fields as BlockFieldConfig[])
            }
        }
    }

    visitFields(fields)

    return [...blockTypes]
}

const regexSpecialCharactersPattern = /[.*+?^${}()|[\]\\]/g

export const getRequestedBlockTypes = ({ availableBlockTypes, mentions, prompt }: { availableBlockTypes: string[]; mentions?: ChatMention[]; prompt: string }) => {
    const requestedBlockTypes = new Set<string>()
    const normalizedPrompt = prompt.toLowerCase()
    const availableBlockTypeSet = new Set(availableBlockTypes)
    const blockTypesByNormalizedSlug = new Map(availableBlockTypes.map((blockType) => [blockType.toLowerCase(), blockType]))
    const escapedBlockTypes = availableBlockTypes.map((blockType) => blockType.replace(regexSpecialCharactersPattern, "\\$&")).join("|")
    const blockPattern = escapedBlockTypes ? new RegExp(`\\b(${escapedBlockTypes})\\b(?:\\s+block)?`, "gi") : null

    for (const mention of mentions || []) {
        if (mention.type === "block" && mention.slug && availableBlockTypeSet.has(mention.slug)) {
            requestedBlockTypes.add(mention.slug)
        }
    }

    if (blockPattern) {
        for (const match of normalizedPrompt.matchAll(blockPattern)) {
            const blockType = match[1] ? blockTypesByNormalizedSlug.get(match[1].toLowerCase()) : null

            if (blockType) {
                requestedBlockTypes.add(blockType)
            }
        }
    }

    return [...requestedBlockTypes]
}

export const collectProposalBlockTypes = ({ data, fields }: { data: Record<string, unknown>; fields: readonly BlockFieldConfig[] }): Set<string> => {
    const foundBlockTypes = new Set<string>()

    const visitFields = (items: readonly BlockFieldConfig[], value: Record<string, unknown>) => {
        for (const field of items) {
            if (!field.name) continue

            const fieldValue = value[field.name]
            if (fieldValue === undefined || fieldValue === null) continue

            if (field.type === "blocks" && Array.isArray(fieldValue)) {
                const blocksBySlug = new Map(field.blocks?.map((block) => [block.slug, block]))

                for (const blockItem of fieldValue) {
                    if (!isRecord(blockItem)) continue

                    const blockType =
                        typeof blockItem.blockType === "string"
                            ? blockItem.blockType
                            : typeof blockItem.type === "string"
                              ? blockItem.type
                              : typeof blockItem.slug === "string"
                                ? blockItem.slug
                                : null

                    if (blockType) {
                        foundBlockTypes.add(blockType)
                    }

                    if (blockType) {
                        const blockConfig = blocksBySlug.get(blockType)
                        if (blockConfig?.fields?.length) {
                            visitFields(blockConfig.fields as BlockFieldConfig[], blockItem)
                        }
                    }
                }

                continue
            }

            if (field.type === "group" && isRecord(fieldValue) && field.fields?.length) {
                visitFields(field.fields as BlockFieldConfig[], fieldValue)
                continue
            }

            if (field.type === "array" && Array.isArray(fieldValue) && field.fields?.length) {
                for (const item of fieldValue) {
                    if (isRecord(item)) {
                        visitFields(field.fields as BlockFieldConfig[], item)
                    }
                }
            }
        }
    }

    visitFields(fields, data)

    return foundBlockTypes
}

const collectRelationshipTargets = ({
    data,
    fields,
    path = "",
}: {
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
    path?: string
}): RelationshipTargetReference[] => {
    const targets: RelationshipTargetReference[] = []

    for (const field of fields) {
        if (!field.name) continue

        const fieldPath = path ? `${path}.${field.name}` : field.name
        const fieldValue = data[field.name]

        if (fieldValue === undefined || fieldValue === null) continue

        if (field.type === "relationship" || field.type === "upload") {
            const relationTargets = Array.isArray(field.relationTo)
                ? field.relationTo.filter((item): item is string => typeof item === "string")
                : typeof field.relationTo === "string"
                  ? [field.relationTo]
                  : []

            const collectSingle = (value: unknown, itemPath: string) => {
                if (typeof value === "string" || typeof value === "number") {
                    if (relationTargets.length === 1) {
                        targets.push({
                            collection: relationTargets[0],
                            id: value,
                            path: itemPath,
                        })
                    }

                    return
                }

                if (!isRecord(value)) return

                const relationTo = typeof value.relationTo === "string" ? value.relationTo : relationTargets[0]
                const id =
                    typeof value.id === "string" || typeof value.id === "number"
                        ? value.id
                        : typeof value.value === "string" || typeof value.value === "number"
                          ? value.value
                          : undefined

                if (!relationTo || id === undefined) return

                targets.push({
                    collection: relationTo,
                    id,
                    path: itemPath,
                })
            }

            if (field.hasMany && Array.isArray(fieldValue)) {
                fieldValue.forEach((item, index) => collectSingle(item, `${fieldPath}.${index}`))
            } else {
                collectSingle(fieldValue, fieldPath)
            }

            continue
        }

        if (field.type === "group" && isRecord(fieldValue) && field.fields?.length) {
            targets.push(
                ...collectRelationshipTargets({
                    data: fieldValue,
                    fields: field.fields as BlockFieldConfig[],
                    path: fieldPath,
                })
            )
            continue
        }

        if (field.type === "array" && Array.isArray(fieldValue) && field.fields?.length) {
            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                targets.push(
                    ...collectRelationshipTargets({
                        data: item,
                        fields: field.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
            continue
        }

        if (field.type === "blocks" && Array.isArray(fieldValue) && field.blocks?.length) {
            const blocksBySlug = new Map(field.blocks.map((block) => [block.slug, block]))

            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                const blockType =
                    typeof item.blockType === "string"
                        ? item.blockType
                        : typeof item.type === "string"
                          ? item.type
                          : typeof item.slug === "string"
                            ? item.slug
                            : null

                if (!blockType) return

                const blockConfig = blocksBySlug.get(blockType)
                if (!blockConfig?.fields?.length) return

                targets.push(
                    ...collectRelationshipTargets({
                        data: item,
                        fields: blockConfig.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
        }
    }

    return targets
}

const collectUploadTargets = ({
    data,
    fields,
    path = "",
}: {
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
    path?: string
}): RelationshipTargetReference[] => {
    const targets: RelationshipTargetReference[] = []

    for (const field of fields) {
        if (!field.name) continue

        const fieldPath = path ? `${path}.${field.name}` : field.name
        const fieldValue = data[field.name]

        if (fieldValue === undefined || fieldValue === null) continue

        if (field.type === "upload") {
            const relationTargets = Array.isArray(field.relationTo)
                ? field.relationTo.filter((item): item is string => typeof item === "string")
                : typeof field.relationTo === "string"
                  ? [field.relationTo]
                  : []

            const collectSingle = (value: unknown, itemPath: string) => {
                if (typeof value === "string" || typeof value === "number") {
                    if (relationTargets.length === 1) {
                        targets.push({
                            collection: relationTargets[0],
                            id: value,
                            path: itemPath,
                        })
                    }

                    return
                }

                if (!isRecord(value)) return

                const relationTo = typeof value.relationTo === "string" ? value.relationTo : relationTargets[0]
                const id =
                    typeof value.id === "string" || typeof value.id === "number"
                        ? value.id
                        : typeof value.value === "string" || typeof value.value === "number"
                          ? value.value
                          : undefined

                if (!relationTo || id === undefined) return

                targets.push({
                    collection: relationTo,
                    id,
                    path: itemPath,
                })
            }

            if (field.hasMany && Array.isArray(fieldValue)) {
                fieldValue.forEach((item, index) => collectSingle(item, `${fieldPath}.${index}`))
            } else {
                collectSingle(fieldValue, fieldPath)
            }

            continue
        }

        if (field.type === "group" && isRecord(fieldValue) && field.fields?.length) {
            targets.push(
                ...collectUploadTargets({
                    data: fieldValue,
                    fields: field.fields as BlockFieldConfig[],
                    path: fieldPath,
                })
            )
            continue
        }

        if (field.type === "array" && Array.isArray(fieldValue) && field.fields?.length) {
            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                targets.push(
                    ...collectUploadTargets({
                        data: item,
                        fields: field.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
            continue
        }

        if (field.type === "blocks" && Array.isArray(fieldValue) && field.blocks?.length) {
            const blocksBySlug = new Map(field.blocks.map((block) => [block.slug, block]))

            fieldValue.forEach((item, index) => {
                if (!isRecord(item)) return

                const blockType =
                    typeof item.blockType === "string"
                        ? item.blockType
                        : typeof item.type === "string"
                          ? item.type
                          : typeof item.slug === "string"
                            ? item.slug
                            : null

                if (!blockType) return

                const blockConfig = blocksBySlug.get(blockType)
                if (!blockConfig?.fields?.length) return

                targets.push(
                    ...collectUploadTargets({
                        data: item,
                        fields: blockConfig.fields as BlockFieldConfig[],
                        path: `${fieldPath}.${index}`,
                    })
                )
            })
        }
    }

    return targets
}

export const validateRelationshipTargetsExist = async ({
    data,
    fields,
    req,
}: {
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
    req: Parameters<PayloadHandler>[0]
}) => {
    const targets = collectRelationshipTargets({
        data,
        fields,
    })

    const targetResults = await Promise.all(
        targets.map(async (target) => {
            try {
                await req.payload.findByID({
                    collection: target.collection as never,
                    depth: 0,
                    id: String(target.id),
                    overrideAccess: false,
                    req,
                })
                return null
            } catch {
                return target
            }
        })
    )

    return targetResults.filter((target): target is RelationshipTargetReference => Boolean(target))
}

export const getUploadTargetsOutsideAttachments = ({
    allowedAttachmentKeys,
    data,
    fields,
}: {
    allowedAttachmentKeys: Set<string>
    data: Record<string, unknown>
    fields: readonly BlockFieldConfig[]
}) => {
    if (allowedAttachmentKeys.size === 0) return []

    return collectUploadTargets({
        data,
        fields,
    }).filter((target) => !allowedAttachmentKeys.has(`${target.collection}:${String(target.id)}`))
}

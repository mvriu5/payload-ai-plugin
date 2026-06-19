import type { PayloadHandler } from "payload"

import { getCollectionPermissions, getCollectionSlugsForAction, type ResolvedCollectionPermissionMap } from "./collectionPermissions.js"
import { getCollectionFields, isAuthCollection, type CollectionConfig as NormalizeCollectionConfig } from "./normalizeData.js"
import { getSerializableLabel, isInternalCollection, isRecord } from "./shared.js"

export type ChatMention = {
    collection?: string
    id?: string
    label?: string
    parent?: string
    slug?: string
    type?: "block" | "collection" | "doc" | "global" | "locale"
}

export type FieldConfig = {
    admin?: {
        condition?: unknown
    }
    blocks?: BlockConfig[]
    defaultValue?: unknown
    fields?: FieldConfig[]
    hasMany?: boolean
    label?: unknown
    localized?: boolean
    name?: string
    options?: (string | { label?: unknown; value?: string })[]
    relationTo?: unknown
    required?: boolean
    type?: string
}

type BlockConfig = {
    fields?: FieldConfig[]
    labels?: {
        plural?: unknown
        singular?: unknown
    }
    slug: string
}

type VersionConfig = boolean | { drafts?: boolean | Record<string, unknown> }

type CollectionLikeConfig = {
    admin?: {
        useAsTitle?: string
    }
    access?: Record<string, unknown>
    auth?: unknown
    fields?: FieldConfig[]
    label?: unknown
    labels?: {
        plural?: unknown
        singular?: unknown
    }
    slug: string
    versions?: VersionConfig
}

type MentionContext = {
    blockContexts: (Record<string, unknown> & {
        parent: string
        slug: string
    })[]
    collectionSlugs: string[]
    collections?: ResolvedCollectionPermissionMap
    globalSlugs: string[]
    mentions?: ChatMention[]
    req: Parameters<PayloadHandler>[0]
}

type LocaleConfig = {
    code: string
    isDefault?: boolean
    label: string
}

const getSerializableRelationTo = (relationTo: unknown) => {
    if (typeof relationTo === "string") return relationTo

    if (Array.isArray(relationTo) && relationTo.every((item) => typeof item === "string")) {
        return relationTo
    }

    return undefined
}

const getLocaleConfigs = (req: Parameters<PayloadHandler>[0]): LocaleConfig[] => {
    const localization = (req.payload.config as { localization?: { defaultLocale?: string; locales?: unknown[] } }).localization
    const defaultLocale = localization?.defaultLocale
    const locales = localization?.locales || []

    return locales.flatMap((locale) => {
        if (typeof locale === "string") {
            return [
                {
                    code: locale,
                    ...(locale === defaultLocale ? { isDefault: true } : {}),
                    label: locale,
                },
            ]
        }

        if (!isRecord(locale)) return []

        const code =
            "code" in locale && typeof locale.code === "string" ? locale.code : "label" in locale && typeof locale.label === "string" ? locale.label : undefined

        if (!code) return []

        const label = "label" in locale ? getSerializableLabel(locale.label, code) : code

        return [
            {
                code,
                ...(code === defaultLocale ? { isDefault: true } : {}),
                label,
            },
        ]
    })
}

const getSerializableOptions = (options: unknown) => {
    if (!Array.isArray(options)) return undefined

    const serializedOptions = options
        .map((option) => {
            if (typeof option === "string") {
                return {
                    label: option,
                    value: option,
                }
            }

            if (!isRecord(option)) return null

            const label = "label" in option ? getSerializableLabel(option.label) : undefined
            const value = "value" in option && typeof option.value === "string" ? option.value : undefined

            if (!label && !value) return null

            return {
                ...(label ? { label } : {}),
                ...(value ? { value } : {}),
            }
        })
        .filter(Boolean)

    return serializedOptions.length > 0 ? serializedOptions : undefined
}

const hasDrafts = (config?: CollectionLikeConfig | null) => {
    const versions = config?.versions

    if (!versions || versions === true) return false
    if (!isRecord(versions)) return false

    return Boolean(versions.drafts)
}

const toNormalizeCollectionConfig = (config?: CollectionLikeConfig | null): NormalizeCollectionConfig | undefined => {
    if (!config) return undefined

    return {
        auth: config.auth,
        fields: config.fields || [],
        slug: config.slug,
    }
}

const getSchemaFields = (config?: CollectionLikeConfig | null) => {
    const normalizedConfig = toNormalizeCollectionConfig(config)
    const fields = isAuthCollection(normalizedConfig) ? getCollectionFields(normalizedConfig) : [...(config?.fields || [])]

    if (hasDrafts(config)) {
        fields.push({
            label: "Status",
            name: "_status",
            options: ["draft", "published"],
            required: true,
            type: "select",
        })
    }

    return fields
}

const getLocalizedFieldNames = (fields: FieldConfig[], path = ""): string[] => {
    return fields.flatMap((field) => {
        const fieldPath = field.name ? (path ? `${path}.${field.name}` : field.name) : path
        const nestedFields = field.fields ? getLocalizedFieldNames(field.fields, fieldPath) : []
        const nestedBlocks = field.blocks ? field.blocks.flatMap((block) => getLocalizedFieldNames(block.fields || [], `${fieldPath}.${block.slug}`)) : []

        return [...(field.localized && fieldPath ? [fieldPath] : []), ...nestedFields, ...nestedBlocks]
    })
}

export const describeCollectionLikeConfig = ({
    config,
    permissions,
    type,
}: {
    config: CollectionLikeConfig
    permissions?: ResolvedCollectionPermissionMap
    type: "collection" | "global"
}) => {
    const slug = config.slug
    const fields = getSchemaFields(config)
    const localizedFieldNames = getLocalizedFieldNames(fields)

    return {
        access: {
            aiPermissions:
                type === "collection"
                    ? getCollectionPermissions({
                          permissions,
                          slug,
                      })
                    : {
                          read: true,
                          update: true,
                      },
            hasPayloadAccessControl: Boolean(config.access),
        },
        fields: fields.map(describeField),
        hasAuth: isAuthCollection(toNormalizeCollectionConfig(config)) || undefined,
        hasDrafts: hasDrafts(config) || undefined,
        hasLocalizedFields: localizedFieldNames.length > 0 || undefined,
        label: type === "collection" ? config.labels?.plural || config.labels?.singular || slug : getSerializableLabel(config.label) || slug,
        ...(localizedFieldNames.length > 0 ? { localizedFieldNames } : {}),
        ...(type === "collection" && config.admin?.useAsTitle ? { useAsTitle: config.admin.useAsTitle } : {}),
        slug,
        type,
    }
}

const describeField = (field: FieldConfig): Record<string, unknown> => {
    const label = getSerializableLabel(field.label)
    const relationTo = getSerializableRelationTo(field.relationTo)
    const options = getSerializableOptions(field.options)

    return {
        ...(label ? { label } : {}),
        ...(field.name ? { name: field.name } : {}),
        ...(field.type ? { type: field.type } : {}),
        ...(field.required ? { required: field.required } : {}),
        ...(field.hasMany ? { hasMany: field.hasMany } : {}),
        ...(field.localized ? { localized: field.localized } : {}),
        ...(relationTo ? { relationTo } : {}),
        ...(options ? { options } : {}),
        ...(field.admin?.condition ? { hasCondition: true } : {}),
        ...(field.fields ? { fields: field.fields.map(describeField) } : {}),
        ...(field.blocks ? { blocks: field.blocks.map(describeBlock) } : {}),
    }
}

const describeBlock = (block: BlockConfig): Record<string, unknown> => {
    return {
        fields: (block.fields || []).map(describeField),
        label: getSerializableLabel(block.labels?.singular) || block.slug,
        slug: block.slug,
    }
}

export const collectBlocks = ({ fields, parent }: { fields: FieldConfig[]; parent: string }) => {
    const blocks: (Record<string, unknown> & {
        parent: string
        slug: string
    })[] = []

    for (const field of fields) {
        if (field.type === "blocks" && field.blocks) {
            for (const block of field.blocks) {
                blocks.push({
                    ...describeBlock(block),
                    parent,
                    slug: block.slug,
                })

                blocks.push(
                    ...collectBlocks({
                        fields: block.fields || [],
                        parent: `${parent}/${block.slug}`,
                    })
                )
            }
        }

        if (field.fields) {
            blocks.push(
                ...collectBlocks({
                    fields: field.fields,
                    parent,
                })
            )
        }
    }

    return blocks
}

export const getAllowedCollectionSlugs = (req: Parameters<PayloadHandler>[0], collections?: ResolvedCollectionPermissionMap) => {
    return getCollectionSlugsForAction({
        action: "read",
        permissions: collections,
        req,
    })
}

export const getMentionContext = async ({ blockContexts, collectionSlugs, collections, globalSlugs, mentions, req }: MentionContext) => {
    if (!mentions || mentions.length === 0) return []

    const context: Record<string, unknown>[] = []
    const seen = new Set<string>()
    const localeConfigs = getLocaleConfigs(req)
    const selectedLocales = (mentions.filter((mention) => mention.type === "locale" && mention.slug).map((mention) => mention.slug as string) || []).filter(
        (locale, index, array) => array.indexOf(locale) === index
    )
    const activeLocale = selectedLocales.at(-1)

    if (localeConfigs.length > 0) {
        context.push({
            activeLocale,
            defaultLocale: localeConfigs.find((locale) => locale.isDefault)?.code,
            locales: localeConfigs,
            selectedLocales,
            type: "locales",
        })
    }

    for (const mention of mentions.slice(0, 8)) {
        if (mention.type === "locale" && mention.slug) {
            const locale = localeConfigs.find((item) => item.code === mention.slug)
            if (!locale) continue

            const key = `locale:${locale.code}`
            if (seen.has(key)) continue

            seen.add(key)
            context.push({
                ...locale,
                type: "locale",
            })
        }

        if (mention.type === "collection" && mention.slug) {
            const slug = mention.slug
            const key = `collection:${slug}`

            if (seen.has(key) || isInternalCollection(slug) || !collectionSlugs.includes(slug)) continue

            const collectionConfig = req.payload.config.collections.find((collection) => collection.slug === slug)
            if (!collectionConfig) continue

            seen.add(key)
            context.push(
                describeCollectionLikeConfig({
                    config: collectionConfig as CollectionLikeConfig,
                    permissions: collections,
                    type: "collection",
                })
            )
        }

        if (mention.type === "global" && mention.slug) {
            const slug = mention.slug
            const key = `global:${slug}`

            if (seen.has(key) || !globalSlugs.includes(slug)) continue

            const globalConfig = req.payload.config.globals?.find((global) => global.slug === slug)
            if (!globalConfig) continue

            const globalDoc = await req.payload
                .findGlobal({
                    depth: 2,
                    ...(activeLocale ? { locale: activeLocale } : {}),
                    overrideAccess: false,
                    req,
                    slug: slug as never,
                })
                .catch(() => null)

            seen.add(key)
            context.push({
                ...describeCollectionLikeConfig({
                    config: globalConfig as CollectionLikeConfig,
                    type: "global",
                }),
                doc: globalDoc,
            })
        }

        if (mention.type === "block" && mention.slug) {
            const matchingBlocks = blockContexts.filter((block) => block.slug === mention.slug && (!mention.parent || block.parent === mention.parent))

            for (const block of matchingBlocks) {
                const key = `block:${block.parent}:${block.slug}`

                if (seen.has(key)) continue

                seen.add(key)
                context.push({
                    ...block,
                    type: "block",
                })
            }
        }

        if (mention.type === "doc" && mention.collection && mention.id) {
            const slug = mention.collection
            const key = `doc:${slug}:${mention.id}`

            if (seen.has(key) || isInternalCollection(slug) || !collectionSlugs.includes(slug)) continue

            const doc = await req.payload
                .findByID({
                    collection: slug as never,
                    depth: 2,
                    id: mention.id,
                    ...(activeLocale ? { locale: activeLocale } : {}),
                    overrideAccess: false,
                    req,
                })
                .catch(() => null)

            if (!doc) continue

            seen.add(key)
            context.push({
                collection: slug,
                doc,
                id: mention.id,
                label: mention.label || mention.id,
                ...(activeLocale ? { locale: activeLocale } : {}),
                type: "doc",
            })
        }
    }

    return context
}

export const buildPromptWithMentionContext = ({ mentionContext, prompt }: { mentionContext: Record<string, unknown>[]; prompt: string }) => {
    if (mentionContext.length === 0) return prompt

    return [
        "The user selected the following Payload CMS references in the input. Treat inline text like `collection: Name`, `document: Name`, or `locale: de` as references to this context, not as literal content.",
        JSON.stringify(mentionContext, null, 2),
        "User request:",
        prompt,
    ].join("\n\n")
}

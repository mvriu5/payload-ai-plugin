import { getCollectionPermissions, type ResolvedCollectionPermissionMap } from "../collectionPermissions.js"
import { getSchemaFields as getNormalizeSchemaFields, hasDrafts, isAuthCollection, type CollectionConfig as NormalizeCollectionConfig } from "./normalize.js"
import { getSerializableLabel, isRecord } from "../../utils/data.js"

export type FieldConfig = {
    admin?: Record<string, unknown>
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

export type BlockConfig = {
    fields?: FieldConfig[]
    labels?: {
        plural?: unknown
        singular?: unknown
    }
    slug: string
}

export type CollectionLikeConfig = {
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
    versions?: NormalizeCollectionConfig["versions"]
}

type CachedCollectionDescription = {
    fields: Record<string, unknown>[]
    hasAuth?: boolean
    hasDrafts?: boolean
    hasLocalizedFields?: boolean
    label: unknown
    localizedFieldNames?: string[]
    slug: string
    useAsTitle?: string
}

const getSerializableRelationTo = (relationTo: unknown) => {
    if (typeof relationTo === "string") return relationTo

    if (Array.isArray(relationTo) && relationTo.every((item) => typeof item === "string")) {
        return relationTo
    }

    return undefined
}

const fieldDescriptionCache = new WeakMap<FieldConfig, Record<string, unknown>>()
const blockDescriptionCache = new WeakMap<BlockConfig, Record<string, unknown>>()
const collectionDescriptionCache = new WeakMap<CollectionLikeConfig, CachedCollectionDescription>()

const getSerializableOptions = (options: unknown) => {
    if (!Array.isArray(options)) return undefined

    const serializedOptions = options.flatMap((option) => {
        if (typeof option === "string") {
            return [
                {
                    label: option,
                    value: option,
                },
            ]
        }

        if (!isRecord(option)) return []

        const label = "label" in option ? getSerializableLabel(option.label) : undefined
        const value = "value" in option && typeof option.value === "string" ? option.value : undefined

        if (!label && !value) return []

        return [
            {
                ...(label ? { label } : {}),
                ...(value ? { value } : {}),
            },
        ]
    })

    return serializedOptions.length > 0 ? serializedOptions : undefined
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
    return getNormalizeSchemaFields(normalizedConfig) as FieldConfig[]
}

const getLocalizedFieldNames = (fields: FieldConfig[], path = ""): string[] => {
    return fields.flatMap((field) => {
        const fieldPath = field.name ? (path ? `${path}.${field.name}` : field.name) : path
        const nestedFields = field.fields ? getLocalizedFieldNames(field.fields, fieldPath) : []
        const nestedBlocks = field.blocks ? field.blocks.flatMap((block) => getLocalizedFieldNames(block.fields || [], `${fieldPath}.${block.slug}`)) : []

        return [...(field.localized && fieldPath ? [fieldPath] : []), ...nestedFields, ...nestedBlocks]
    })
}

const getCachedCollectionDescription = (config: CollectionLikeConfig, type: "collection" | "global") => {
    const cached = collectionDescriptionCache.get(config)

    if (cached) return cached

    const slug = config.slug
    const fields = getSchemaFields(config)
    const localizedFieldNames = getLocalizedFieldNames(fields)

    const description: CachedCollectionDescription = {
        fields: fields.map(describeField),
        hasAuth: isAuthCollection(toNormalizeCollectionConfig(config)) || undefined,
        hasDrafts: hasDrafts(config) || undefined,
        hasLocalizedFields: localizedFieldNames.length > 0 || undefined,
        label: type === "collection" ? config.labels?.plural || config.labels?.singular || slug : getSerializableLabel(config.label) || slug,
        ...(localizedFieldNames.length > 0 ? { localizedFieldNames } : {}),
        ...(type === "collection" && config.admin?.useAsTitle ? { useAsTitle: config.admin.useAsTitle } : {}),
        slug,
    }

    collectionDescriptionCache.set(config, description)

    return description
}

export const describeCollectionLikeSummary = ({
    config,
    permissions,
    type,
}: {
    config: CollectionLikeConfig
    permissions?: ResolvedCollectionPermissionMap
    type: "collection" | "global"
}) => {
    const description = getCachedCollectionDescription(config, type)
    const slug = description.slug

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
        hasAuth: description.hasAuth,
        hasDrafts: description.hasDrafts,
        hasLocalizedFields: description.hasLocalizedFields,
        label: description.label,
        localizedFieldNames: description.localizedFieldNames,
        slug,
        type,
        useAsTitle: description.useAsTitle,
    }
}

const describeField = (field: FieldConfig): Record<string, unknown> => {
    const cached = fieldDescriptionCache.get(field)

    if (cached) return cached

    const label = getSerializableLabel(field.label)
    const relationTo = getSerializableRelationTo(field.relationTo)
    const options = getSerializableOptions(field.options)

    const description = {
        ...(label ? { label } : {}),
        ...(field.name ? { name: field.name } : {}),
        ...(field.type ? { type: field.type } : {}),
        ...(field.required ? { required: field.required } : {}),
        ...(field.hasMany ? { hasMany: field.hasMany } : {}),
        ...(field.localized ? { localized: field.localized } : {}),
        ...(relationTo ? { relationTo } : {}),
        ...(options ? { options } : {}),
        ...(field.type === "blocks" && field.blocks
            ? {
                  acceptedBlockTypes: field.blocks.map((block) => block.slug),
                  blockExample: [
                      {
                          ...getBlockExample(field.blocks[0]),
                      },
                  ],
              }
            : {}),
        ...(field.admin?.condition ? { hasCondition: true } : {}),
        ...(field.fields ? { fields: field.fields.map(describeField) } : {}),
        ...(field.blocks ? { blocks: field.blocks.map(describeBlock) } : {}),
    }

    fieldDescriptionCache.set(field, description)

    return description
}

const describeBlock = (block: BlockConfig): Record<string, unknown> => {
    const cached = blockDescriptionCache.get(block)

    if (cached) return cached

    const description = {
        blockType: block.slug,
        example: getBlockExample(block),
        fields: (block.fields || []).map(describeField),
        label: getSerializableLabel(block.labels?.singular) || block.slug,
        slug: block.slug,
    }

    blockDescriptionCache.set(block, description)

    return description
}

const getBlockExample = (block?: BlockConfig) => {
    if (!block) return {}

    const example: Record<string, unknown> = {
        blockType: block.slug,
    }

    for (const field of block.fields || []) {
        if (!field.name) continue

        if (field.type === "array") {
            example[field.name] = field.fields?.length
                ? [
                      Object.fromEntries(
                          field.fields
                              .filter((childField): childField is FieldConfig & { name: string } => Boolean(childField.name))
                              .slice(0, 2)
                              .map((childField) => [childField.name, childField.type === "checkbox" ? false : `<${childField.name}>`])
                      ),
                  ]
                : []
            continue
        }

        if (field.type === "blocks") {
            example[field.name] = field.blocks?.length ? [getBlockExample(field.blocks[0])] : []
            continue
        }

        if (field.type === "group") {
            example[field.name] = Object.fromEntries(
                (field.fields || [])
                    .filter((childField): childField is FieldConfig & { name: string } => Boolean(childField.name))
                    .slice(0, 2)
                    .map((childField) => [childField.name, childField.type === "checkbox" ? false : `<${childField.name}>`])
            )
            continue
        }

        if (field.type === "checkbox") {
            example[field.name] = false
            continue
        }

        example[field.name] = `<${field.name}>`
    }

    return example
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
    return {
        ...describeCollectionLikeSummary({
            config,
            permissions,
            type,
        }),
        fields: getCachedCollectionDescription(config, type).fields,
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

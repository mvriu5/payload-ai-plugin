import { isRecord } from "./shared.js"

export type FieldConfig = {
    admin?: Record<string, unknown>
    blocks?: readonly BlockConfig[]
    defaultValue?: unknown
    fields?: readonly FieldConfig[]
    hasMany?: boolean
    label?: unknown
    localized?: boolean
    name?: string
    options?: readonly (string | { value?: string })[]
    relationTo?: unknown
    required?: boolean
    type?: string
}

type BlockConfig = {
    fields?: readonly FieldConfig[]
    slug: string
}

export type CollectionConfig = {
    admin?: Record<string, unknown>
    auth?: unknown
    fields?: readonly FieldConfig[]
    slug: string
    versions?: boolean | { drafts?: boolean | Record<string, unknown> }
}

export type NormalizedData = {
    coercedFields: string[]
    data: Record<string, unknown>
    droppedFields: string[]
}

const SKIP_FIELD = Symbol("skipField")

const getNamedFields = (fields: readonly FieldConfig[]) => {
    return fields.filter((field): field is FieldConfig & { name: string } => Boolean(field.name))
}

export const isAuthCollection = (collectionConfig?: CollectionConfig | null) => {
    return Boolean(collectionConfig?.auth)
}

const getCollectionFields = (collectionConfig?: CollectionConfig | null) => {
    const fields = [...(collectionConfig?.fields || [])]

    if (isAuthCollection(collectionConfig)) {
        fields.push(
            {
                name: "email",
                type: "email",
            },
            {
                name: "password",
                type: "text",
            }
        )
    }

    return fields
}

export const hasDrafts = (collectionConfig?: CollectionConfig | null) => {
    const versions = collectionConfig?.versions

    if (!versions || versions === true || !isRecord(versions)) return false

    return Boolean(versions.drafts)
}

export const getSchemaFields = (collectionConfig?: CollectionConfig | null) => {
    const fields = getCollectionFields(collectionConfig)

    if (hasDrafts(collectionConfig)) {
        fields.push({
            defaultValue: "draft",
            name: "_status",
            options: ["draft", "published"],
            required: true,
            type: "select",
        })
    }

    return fields
}

export const createLexicalText = (value: unknown) => {
    if (isRecord(value) && isRecord(value.root)) return value

    const text = Array.isArray(value) ? value.join("\n") : String(value || "")
    const lines = text.split("\n").flatMap((line) => {
        const trimmedLine = line.trim()
        return trimmedLine ? [trimmedLine] : []
    })

    return {
        root: {
            children: (lines.length ? lines : [""]).map((line) => ({
                children: [
                    {
                        detail: 0,
                        format: 0,
                        mode: "normal",
                        style: "",
                        text: line,
                        type: "text",
                        version: 1,
                    },
                ],
                direction: null,
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
            })),
            direction: null,
            format: "",
            indent: 0,
            type: "root",
            version: 1,
        },
    }
}

const normalizeArrayValue = (field: FieldConfig, value: unknown) => {
    if (!Array.isArray(value)) return value

    const childFields = getNamedFields(field.fields || [])
    const itemLabelField =
        childFields.find((childField) => childField.name === "label") ||
        childFields.find((childField) => childField.name === "title") ||
        childFields.find((childField) => childField.name === "name") ||
        childFields.find((childField) => childField.name === "value") ||
        childFields[0]

    if (!itemLabelField) return value

    return value.map((item) => {
        if (!isRecord(item)) return { [itemLabelField.name]: item }
        return normalizeDataForFields(childFields, item).data
    })
}

const getOptionValues = (field: FieldConfig) => {
    return (field.options || []).flatMap((option) => {
        const value = typeof option === "string" ? option : option.value
        return value ? [value] : []
    })
}

const normalizeOptionValue = (field: FieldConfig, value: unknown) => {
    const optionValues = getOptionValues(field)
    const stringValue = value === null ? "" : String(value)
    const defaultValue = typeof field.defaultValue === "string" ? field.defaultValue : null

    if (stringValue && optionValues.includes(stringValue)) return stringValue
    if (defaultValue && optionValues.includes(defaultValue)) return defaultValue
    return SKIP_FIELD
}

const normalizeBlocksValue = (field: FieldConfig, value: unknown) => {
    if (!Array.isArray(value)) return value

    return value.flatMap((item) => {
        if (!isRecord(item)) return []

        const blockType =
            typeof item.blockType === "string" ? item.blockType : typeof item.type === "string" ? item.type : typeof item.slug === "string" ? item.slug : null

        if (!blockType) return []

        const block = field.blocks?.find((candidate) => candidate.slug === blockType)
        if (!block) return []

        const { blockType: _blockType, type: _type, slug: _slug, ...data } = item
        const normalizedBlock = normalizeDataForFields(block.fields || [], data).data

        return [{ ...normalizedBlock, blockType }]
    })
}

const normalizeFieldValue = (field: FieldConfig, value: unknown): typeof SKIP_FIELD | unknown => {
    if (value === undefined) return value

    if (field.type === "array") return normalizeArrayValue(field, value)
    if (field.type === "blocks") return normalizeBlocksValue(field, value)
    if (field.type === "checkbox") return typeof value === "boolean" ? value : value === "true"
    if (field.type === "group" && isRecord(value)) return normalizeDataForFields(field.fields || [], value).data
    if (field.type === "richText") return createLexicalText(value)
    if (["radio", "select"].includes(field.type || "")) return normalizeOptionValue(field, value)
    if (["email", "text", "textarea"].includes(field.type || "")) return value === null ? value : String(value)
    if (field.type === "date") {
        const date = new Date(String(value))
        return Number.isNaN(date.getTime()) ? value : date.toISOString()
    }
    return value
}

export const normalizeAuthData = (collectionConfig: CollectionConfig | undefined, normalized: NormalizedData) => {
    if (!isAuthCollection(collectionConfig)) return normalized

    const email = normalized.data.email
    const password = normalized.data.password

    if (email !== undefined && typeof email !== "string") {
        normalized.data.email = String(email)
        normalized.coercedFields.push("email")
    }

    if (password !== undefined && typeof password !== "string") {
        normalized.data.password = String(password)
        normalized.coercedFields.push("password")
    }

    if (typeof normalized.data.password === "string" && normalized.data.password.length > 0 && normalized.data.password.length < 8) {
        throw new Error("Password must be at least 8 characters long.")
    }

    return normalized
}

const getAliasFieldName = (key: string, fieldsByName: Map<string, FieldConfig>) => {
    if (fieldsByName.has(key)) return key

    if (key.endsWith("Date")) {
        const dateAlias = `${key.slice(0, -4)}At`
        if (fieldsByName.has(dateAlias)) return dateAlias
    }

    return null
}

const normalizeLooseKnownFieldValue = (key: string, value: unknown) => {
    if (key === "tags" && Array.isArray(value)) {
        return value.map((item) => (isRecord(item) ? item : { label: item }))
    }

    return value
}

export const normalizeDataForFields = (fields: readonly FieldConfig[], data: Record<string, unknown>): NormalizedData => {
    const namedFields = getNamedFields(fields)
    const fieldsByName = new Map(namedFields.map((field) => [field.name, field]))
    const normalizedData: Record<string, unknown> = {}
    const droppedFields: string[] = []
    const coercedFields: string[] = []

    for (const [key, value] of Object.entries(data)) {
        const fieldName = getAliasFieldName(key, fieldsByName)

        if (!fieldName) {
            const looseValue = normalizeLooseKnownFieldValue(key, value)

            if (looseValue !== value) {
                normalizedData[key] = looseValue
                coercedFields.push(key)
                continue
            }

            droppedFields.push(key)
            continue
        }

        const field = fieldsByName.get(fieldName)
        if (!field) continue

        const normalizedValue = normalizeFieldValue(field, value)

        if (normalizedValue === SKIP_FIELD) {
            droppedFields.push(key)
            continue
        }

        if (fieldName !== key || normalizedValue !== value) {
            coercedFields.push(key)
        }

        normalizedData[fieldName] = normalizedValue
    }

    return {
        coercedFields,
        data: normalizedData,
        droppedFields,
    }
}

const getLocalizedRequiredFallbackData = ({
    fields,
    source,
    target,
}: {
    fields: readonly FieldConfig[]
    source: Record<string, unknown>
    target: Record<string, unknown>
}): Record<string, unknown> => {
    const fallbackData: Record<string, unknown> = {}

    for (const field of getNamedFields(fields)) {
        const targetValue = target[field.name]
        const sourceValue = source[field.name]

        if (field.localized && field.required) {
            if (targetValue === undefined && sourceValue !== undefined) {
                fallbackData[field.name] = sourceValue
            }

            continue
        }

        if (field.type === "group" && field.fields?.length && isRecord(sourceValue)) {
            const nestedFallback = getLocalizedRequiredFallbackData({
                fields: field.fields,
                source: sourceValue,
                target: isRecord(targetValue) ? targetValue : {},
            })

            if (Object.keys(nestedFallback).length > 0) {
                fallbackData[field.name] = nestedFallback
            }
        }
    }

    return fallbackData
}

import { getSafeProposalLabel, getOptionValue, isRecord, type LocalizedDataInput } from "./shared.js"
import { createLexicalText, getSchemaFields, normalizeAuthData, normalizeDataForFields, type CollectionConfig, type FieldConfig } from "./normalizeData.js"

type ProposalMode = "create" | "update"

export type ProposalValidationIssue = {
    code:
        | "empty_localized_data"
        | "invalid_array"
        | "invalid_block_type"
        | "invalid_blocks"
        | "invalid_checkbox"
        | "invalid_container"
        | "invalid_date"
        | "invalid_option"
        | "invalid_relationship"
        | "missing_required_field"
        | "non_localized_field_in_secondary_locale"
        | "unknown_field"
    message: string
    path: string
}

export type PreparedProposalData = {
    coercedFields: string[]
    data?: Record<string, unknown>
    issues: ProposalValidationIssue[]
    localizedData?: LocalizedDataInput
}

type PrepareProposalDataArgs = {
    collectionConfig?: CollectionConfig
    data?: Record<string, unknown>
    inferenceText?: string
    label: string
    localizedData?: LocalizedDataInput
    mode: ProposalMode
}

type NormalizeFieldValueArgs = {
    coercedFields: string[]
    enforceRequiredChildren: boolean
    field: FieldConfig
    inferenceText?: string
    issues: ProposalValidationIssue[]
    label: string
    mode: ProposalMode
    path: string
    titleFieldName?: string
    value: unknown
}

const isTitleLikeField = (field: FieldConfig, titleFieldName?: string) => {
    const normalizedName = field.name?.toLowerCase()

    return Boolean(
        field.name &&
        (field.name === titleFieldName ||
            normalizedName === "title" ||
            normalizedName === "name" ||
            normalizedName === "label" ||
            normalizedName === "headline")
    )
}

const getFieldOptionValues = (field: FieldConfig) => {
    return (field.options || []).map((option) => getOptionValue(option)).filter((option): option is string => Boolean(option))
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const getFieldNameVariants = (fieldName?: string) => {
    if (!fieldName) return []

    const spacedName = fieldName
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .toLowerCase()

    return Array.from(new Set([fieldName.toLowerCase(), spacedName])).filter(Boolean)
}

const inferOptionValueFromText = ({ field, requireFieldMention = false, text }: { field: FieldConfig; requireFieldMention?: boolean; text?: string }) => {
    const normalizedText = text?.trim().toLowerCase()
    if (!normalizedText) return undefined

    if (requireFieldMention) {
        const fieldMentioned = getFieldNameVariants(field.name).some((variant) => {
            const pattern = new RegExp(`\\b${escapeRegExp(variant)}\\b`, "i")
            return pattern.test(normalizedText)
        })

        if (!fieldMentioned) return undefined
    }

    const optionValues = getFieldOptionValues(field).sort((left, right) => right.length - left.length)

    return optionValues.find((optionValue) => {
        const pattern = new RegExp(`\\b${escapeRegExp(optionValue.toLowerCase())}\\b`, "i")
        return pattern.test(normalizedText)
    })
}

const getDefaultFieldValue = ({
    field,
    inferenceText,
    label,
    titleFieldName,
}: {
    field: FieldConfig
    inferenceText?: string
    label: string
    titleFieldName?: string
}) => {
    if (field.name === "_status") return "draft"
    if (field.type === "checkbox") return false
    if (field.type === "select" || field.type === "radio") {
        const inferredOptionValue = inferOptionValueFromText({
            field,
            requireFieldMention: true,
            text: inferenceText || label,
        })

        if (inferredOptionValue !== undefined) {
            return inferredOptionValue
        }

        if (field.defaultValue !== undefined) {
            return field.defaultValue
        }

        return getOptionValue(field.options?.[0])
    }

    if (field.defaultValue !== undefined) return field.defaultValue

    if (["email", "text", "textarea"].includes(field.type || "") && isTitleLikeField(field, titleFieldName)) {
        return getSafeProposalLabel(label)
    }

    return undefined
}

const addIssue = (issues: ProposalValidationIssue[], issue: ProposalValidationIssue) => {
    issues.push(issue)
}

const normalizeRelationshipScalar = (value: number | string) => {
    if (typeof value === "number") {
        if (!Number.isInteger(value) || value <= 0) return undefined
        return value
    }

    const trimmedValue = value.trim()
    if (!trimmedValue || /\s/.test(trimmedValue)) return undefined
    if (/^\d+$/.test(trimmedValue) && Number(trimmedValue) <= 0) return undefined

    return trimmedValue
}

const normalizeRelationshipValue = ({
    field,
    issues,
    path,
    value,
}: {
    field: FieldConfig
    issues: ProposalValidationIssue[]
    path: string
    value: unknown
}) => {
    const allowedRelationTargets = Array.isArray(field.relationTo)
        ? field.relationTo.filter((item): item is string => typeof item === "string")
        : typeof field.relationTo === "string"
          ? [field.relationTo]
          : []

    const normalizeSingle = (item: unknown, itemPath: string) => {
        if (typeof item === "number") {
            const normalizedValue = normalizeRelationshipScalar(item)

            if (normalizedValue !== undefined) {
                return normalizedValue
            }

            addIssue(issues, {
                code: "invalid_relationship",
                message: "Relationship and upload fields must use a valid document ID.",
                path: itemPath,
            })
            return undefined
        }

        if (typeof item === "string") {
            const normalizedValue = normalizeRelationshipScalar(item)

            if (normalizedValue !== undefined) {
                return normalizedValue
            }

            addIssue(issues, {
                code: "invalid_relationship",
                message: "Relationship and upload fields must use a valid document ID, not free text.",
                path: itemPath,
            })
            return undefined
        }

        if (!isRecord(item)) {
            addIssue(issues, {
                code: "invalid_relationship",
                message: "Relationship and upload fields must use a document ID or an object with id/value.",
                path: itemPath,
            })
            return undefined
        }

        if (typeof item.id === "string" || typeof item.id === "number") {
            const normalizedValue = normalizeRelationshipScalar(item.id)

            if (normalizedValue !== undefined) {
                return normalizedValue
            }

            addIssue(issues, {
                code: "invalid_relationship",
                message: "Relationship and upload fields must use a valid document ID.",
                path: itemPath,
            })
            return undefined
        }

        if (typeof item.value === "string" || typeof item.value === "number") {
            const normalizedValue = normalizeRelationshipScalar(item.value)

            if (normalizedValue === undefined) {
                addIssue(issues, {
                    code: "invalid_relationship",
                    message: "Relationship and upload fields must use a valid document ID.",
                    path: itemPath,
                })
                return undefined
            }

            if (allowedRelationTargets.length > 1) {
                const relationTo = typeof item.relationTo === "string" ? item.relationTo : null

                if (!relationTo || !allowedRelationTargets.includes(relationTo)) {
                    addIssue(issues, {
                        code: "invalid_relationship",
                        message: `Relationship must include one of: ${allowedRelationTargets.join(", ")}.`,
                        path: itemPath,
                    })
                    return undefined
                }

                return {
                    relationTo,
                    value: normalizedValue,
                }
            }

            return normalizedValue
        }

        addIssue(issues, {
            code: "invalid_relationship",
            message: "Relationship and upload fields must use a document ID or an object with id/value.",
            path: itemPath,
        })
        return undefined
    }

    if (field.hasMany) {
        if (!Array.isArray(value)) {
            addIssue(issues, {
                code: "invalid_relationship",
                message: "Relationship field expects an array of document IDs.",
                path,
            })
            return undefined
        }

        const normalizedValues = value.map((item, index) => normalizeSingle(item, `${path}.${index}`)).filter((item) => item !== undefined)
        return normalizedValues
    }

    return normalizeSingle(value, path)
}

const normalizeFieldValue = ({ coercedFields, enforceRequiredChildren, field, inferenceText, issues, label, mode, path, titleFieldName, value }: NormalizeFieldValueArgs): unknown => {
    if (field.type === "group") {
        if (!isRecord(value)) {
            addIssue(issues, {
                code: "invalid_container",
                message: "Group fields must be objects.",
                path,
            })
            return undefined
        }

        return normalizeRecordForFields({
            allowSafeFallback: false,
            coercedFields,
            enforceRequiredChildren: mode === "create" || enforceRequiredChildren,
            fields: field.fields || [],
            inferenceText,
            issues,
            label,
            mode,
            path,
            titleFieldName,
            value,
        })
    }

    if (field.type === "array") {
        if (!Array.isArray(value)) {
            addIssue(issues, {
                code: "invalid_array",
                message: "Array fields must use an array value.",
                path,
            })
            return undefined
        }

        const childFields = (field.fields || []).filter((childField): childField is FieldConfig & { name: string } => Boolean(childField.name))
        const itemLabelField =
            childFields.find((childField) => childField.name === "label") ||
            childFields.find((childField) => childField.name === "title") ||
            childFields.find((childField) => childField.name === "name") ||
            childFields.find((childField) => childField.name === "value") ||
            childFields[0]

        return value.map((item, index) => {
            const itemPath = `${path}.${index}`

            if (!isRecord(item)) {
                if (!itemLabelField) {
                    addIssue(issues, {
                        code: "invalid_array",
                        message: "Array items must be objects for this field.",
                        path: itemPath,
                    })
                    return undefined
                }

                const wrappedItem = { [itemLabelField.name]: item }
                return normalizeRecordForFields({
                    allowSafeFallback: false,
                    coercedFields,
                    enforceRequiredChildren: true,
                    fields: field.fields || [],
                    inferenceText,
                    issues,
                    label,
                    mode,
                    path: itemPath,
                    titleFieldName,
                    value: wrappedItem,
                })
            }

            return normalizeRecordForFields({
                allowSafeFallback: false,
                coercedFields,
                enforceRequiredChildren: true,
                fields: field.fields || [],
                inferenceText,
                issues,
                label,
                mode,
                path: itemPath,
                titleFieldName,
                value: item,
            })
        })
    }

    if (field.type === "blocks") {
        if (!Array.isArray(value)) {
            addIssue(issues, {
                code: "invalid_blocks",
                message: "Blocks fields must use an array value.",
                path,
            })
            return undefined
        }

        return value.map((item, index) => {
            const itemPath = `${path}.${index}`

            if (!isRecord(item)) {
                addIssue(issues, {
                    code: "invalid_blocks",
                    message: "Each block entry must be an object.",
                    path: itemPath,
                })
                return undefined
            }

            const blockType =
                typeof item.blockType === "string"
                    ? item.blockType
                    : typeof item.type === "string"
                      ? item.type
                      : typeof item.slug === "string"
                        ? item.slug
                        : null

            if (!blockType) {
                addIssue(issues, {
                    code: "invalid_block_type",
                    message: "Each block entry must include blockType.",
                    path: itemPath,
                })
                return undefined
            }

            const block = field.blocks?.find((candidate) => candidate.slug === blockType)

            if (!block) {
                addIssue(issues, {
                    code: "invalid_block_type",
                    message: `Unknown block type "${blockType}".`,
                    path: `${itemPath}.blockType`,
                })
                return undefined
            }

            const { blockType: _blockType, slug: _slug, type: _type, ...blockData } = item
            const normalizedBlock = normalizeRecordForFields({
                allowSafeFallback: false,
                coercedFields,
                enforceRequiredChildren: true,
                fields: block.fields || [],
                inferenceText,
                issues,
                label,
                mode,
                path: itemPath,
                titleFieldName,
                value: blockData,
            })

            return {
                ...normalizedBlock,
                blockType,
            }
        })
    }

    if (field.type === "checkbox") {
        if (typeof value === "boolean") return value
        if (value === "true") return true
        if (value === "false") return false

        addIssue(issues, {
            code: "invalid_checkbox",
            message: "Checkbox fields must use true or false.",
            path,
        })
        return undefined
    }

    if (field.type === "relationship" || field.type === "upload") {
        return normalizeRelationshipValue({
            field,
            issues,
            path,
            value,
        })
    }

    if (field.type === "richText") return createLexicalText(value)

    if (field.type === "select" || field.type === "radio") {
        const optionValues = getFieldOptionValues(field)
        const stringValue = value === null ? "" : String(value)
        const inferredOptionValue = inferOptionValueFromText({
            field,
            requireFieldMention: true,
            text: inferenceText || label,
        })

        if (inferredOptionValue && optionValues.includes(inferredOptionValue)) {
            if (stringValue !== inferredOptionValue) {
                coercedFields.push(path)
            }

            return inferredOptionValue
        }

        if (stringValue && optionValues.includes(stringValue)) return stringValue

        addIssue(issues, {
            code: "invalid_option",
            message: `Field must use one of: ${optionValues.join(", ")}.`,
            path,
        })
        return undefined
    }

    if (["email", "text", "textarea"].includes(field.type || "")) {
        return value === null ? value : String(value)
    }

    if (field.type === "date") {
        const date = new Date(String(value))

        if (Number.isNaN(date.getTime())) {
            addIssue(issues, {
                code: "invalid_date",
                message: "Date fields must use a valid date value.",
                path,
            })
            return undefined
        }

        return date.toISOString()
    }

    return value
}

const normalizeRecordForFields = ({
    allowSafeFallback,
    coercedFields,
    enforceRequiredChildren,
    fields,
    inferenceText,
    issues,
    label,
    mode,
    path,
    titleFieldName,
    value,
}: {
    allowSafeFallback: boolean
    coercedFields: string[]
    enforceRequiredChildren: boolean
    fields: readonly FieldConfig[]
    inferenceText?: string
    issues: ProposalValidationIssue[]
    label: string
    mode: ProposalMode
    path: string
    titleFieldName?: string
    value: Record<string, unknown>
}) => {
    const normalizedData: Record<string, unknown> = {}
    const fieldsByName = new Map(fields.filter((field): field is FieldConfig & { name: string } => Boolean(field.name)).map((field) => [field.name, field]))

    for (const [key, fieldValue] of Object.entries(value)) {
        const field = fieldsByName.get(key)
        const fieldPath = path ? `${path}.${key}` : key

        if (!field) {
            addIssue(issues, {
                code: "unknown_field",
                message: "Field does not exist in the schema.",
                path: fieldPath,
            })
            continue
        }

        const normalizedValue = normalizeFieldValue({
            coercedFields,
            enforceRequiredChildren,
            field,
            inferenceText,
            issues,
            label,
            mode,
            path: fieldPath,
            titleFieldName,
            value: fieldValue,
        })

        if (normalizedValue !== undefined) {
            normalizedData[key] = normalizedValue
        }
    }

    if (mode === "create" || enforceRequiredChildren) {
        for (const field of fields.filter((candidate): candidate is FieldConfig & { name: string } => Boolean(candidate.name) && candidate.required === true)) {
            const fieldPath = path ? `${path}.${field.name}` : field.name

            if (normalizedData[field.name] === undefined) {
                if (allowSafeFallback) {
                    const fallbackValue = getDefaultFieldValue({
                        field,
                        inferenceText,
                        label,
                        titleFieldName,
                    })

                    if (fallbackValue !== undefined) {
                        normalizedData[field.name] = fallbackValue
                        continue
                    }
                }

                addIssue(issues, {
                    code: "missing_required_field",
                    message: "Required field is missing.",
                    path: fieldPath,
                })
            }
        }
    }

    for (const field of fields.filter((candidate): candidate is FieldConfig & { name: string } => Boolean(candidate.name))) {
        if (normalizedData[field.name] !== undefined) continue
        if (field.type !== "select" && field.type !== "radio") continue

        const inferredOptionValue = inferOptionValueFromText({
            field,
            requireFieldMention: true,
            text: inferenceText || label,
        })

        if (inferredOptionValue !== undefined) {
            normalizedData[field.name] = inferredOptionValue
            coercedFields.push(path ? `${path}.${field.name}` : field.name)
        }
    }

    return normalizedData
}

const prepareSingleLocaleData = ({
    coercedFields,
    data,
    fields,
    inferenceText,
    issues,
    label,
    mode,
    titleFieldName,
}: {
    coercedFields: string[]
    data: Record<string, unknown>
    fields: readonly FieldConfig[]
    inferenceText?: string
    issues: ProposalValidationIssue[]
    label: string
    mode: ProposalMode
    titleFieldName?: string
}) => {
    const normalizedData = normalizeRecordForFields({
        allowSafeFallback: true,
        coercedFields,
        enforceRequiredChildren: false,
        fields,
        inferenceText,
        issues,
        label,
        mode,
        path: "",
        titleFieldName,
        value: data,
    })

    return normalizeDataForFields(fields, normalizedData).data
}

export const prepareProposalWriteData = ({ collectionConfig, data, inferenceText, label, localizedData, mode }: PrepareProposalDataArgs): PreparedProposalData => {
    const schemaFields = getSchemaFields(collectionConfig)
    const titleFieldName = typeof collectionConfig?.admin?.useAsTitle === "string" ? collectionConfig.admin.useAsTitle : undefined
    const issues: ProposalValidationIssue[] = []
    const coercedFields: string[] = []

    if (localizedData) {
        const localeEntries = Object.entries(localizedData)

        if (localeEntries.length === 0) {
            addIssue(issues, {
                code: "empty_localized_data",
                message: "localizedData must contain at least one locale entry.",
                path: "localizedData",
            })

            return {
                coercedFields,
                issues,
                localizedData: {},
            }
        }

        const normalizedLocalizedData: LocalizedDataInput = {}

        for (const [locale, localeValue] of localeEntries) {
            if (!isRecord(localeValue)) {
                addIssue(issues, {
                    code: "invalid_container",
                    message: "Each locale entry must be an object.",
                    path: `localizedData.${locale}`,
                })
                continue
            }

            const normalizedLocaleData = prepareSingleLocaleData({
                coercedFields,
                data: localeValue,
                fields: schemaFields,
                inferenceText,
                issues,
                label,
                mode,
                titleFieldName,
            })

            normalizedLocalizedData[locale] = normalizedLocaleData
        }

        const [firstLocale] = localeEntries[0] || []

        if (firstLocale) {
            for (const field of schemaFields.filter((candidate): candidate is FieldConfig & { name: string } => Boolean(candidate.name))) {
                if (!field.localized) {
                    for (const [locale, localeValue] of Object.entries(normalizedLocalizedData)) {
                        if (locale === firstLocale) continue

                        if (localeValue[field.name] !== undefined) {
                            addIssue(issues, {
                                code: "non_localized_field_in_secondary_locale",
                                message: "Non-localized fields may only be set in the first locale entry.",
                                path: `localizedData.${locale}.${field.name}`,
                            })
                        }
                    }
                }
            }
        }

        const normalizedResult: LocalizedDataInput = {}

        for (const [locale, localeValue] of Object.entries(normalizedLocalizedData)) {
            normalizedResult[locale] = normalizeAuthData(collectionConfig, {
                coercedFields: [],
                data: localeValue,
                droppedFields: [],
            }).data
        }

        return {
            coercedFields,
            issues,
            localizedData: normalizedResult,
        }
    }

    const sourceData = data || {}
    const normalizedData = prepareSingleLocaleData({
        coercedFields,
        data: sourceData,
        fields: schemaFields,
        inferenceText,
        issues,
        label,
        mode,
        titleFieldName,
    })
    const authNormalized = normalizeAuthData(collectionConfig, {
        coercedFields: [],
        data: normalizedData,
        droppedFields: [],
    })

    coercedFields.push(...authNormalized.coercedFields)

    return {
        coercedFields,
        data: authNormalized.data,
        issues,
    }
}

export const applyLocalizedRequiredFallbackToPreparedData = ({
    fallbackSource,
    fields,
    preparedData,
}: {
    fallbackSource: Record<string, unknown>
    fields: readonly FieldConfig[]
    preparedData: Record<string, unknown>
}) => {
    const mergedData = { ...preparedData }

    for (const field of fields.filter((candidate): candidate is FieldConfig & { name: string } => Boolean(candidate.name))) {
        if (field.localized && field.required && mergedData[field.name] === undefined && fallbackSource[field.name] !== undefined) {
            mergedData[field.name] = fallbackSource[field.name] as never
            continue
        }

        if (field.type === "group" && field.fields?.length && isRecord(fallbackSource[field.name])) {
            const currentValue = isRecord(mergedData[field.name]) ? (mergedData[field.name] as Record<string, unknown>) : {}
            const nestedValue = applyLocalizedRequiredFallbackToPreparedData({
                fallbackSource: fallbackSource[field.name] as Record<string, unknown>,
                fields: field.fields,
                preparedData: currentValue,
            })

            if (Object.keys(nestedValue).length > 0) {
                mergedData[field.name] = nestedValue
            }
        }
    }

    return mergedData
}

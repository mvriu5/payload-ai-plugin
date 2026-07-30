import type { FieldConfig } from "../schema/normalize.js"
import { getOptionValue, getSafeProposalLabel } from "../../utils/data.js"

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

export const getFieldOptionValues = (field: FieldConfig) =>
    (field.options || []).map((option) => getOptionValue(option)).filter((option): option is string => Boolean(option))

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

const getFieldNameVariants = (fieldName?: string) => {
    if (!fieldName) return []

    const spacedName = fieldName
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_-]+/g, " ")
        .toLowerCase()

    return Array.from(new Set([fieldName.toLowerCase(), spacedName])).filter(Boolean)
}

export const inferOptionValueFromText = ({
    field,
    requireFieldMention = false,
    text,
}: {
    field: FieldConfig
    requireFieldMention?: boolean
    text?: string
}) => {
    const normalizedText = text?.trim().toLowerCase()
    if (!normalizedText) return undefined

    if (requireFieldMention && !getFieldNameVariants(field.name).some((variant) => new RegExp(`\\b${escapeRegExp(variant)}\\b`, "i").test(normalizedText))) {
        return undefined
    }

    return getFieldOptionValues(field)
        .sort((left, right) => right.length - left.length)
        .find((optionValue) => new RegExp(`\\b${escapeRegExp(optionValue.toLowerCase())}\\b`, "i").test(normalizedText))
}

export const getDefaultFieldValue = ({
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

        if (inferredOptionValue !== undefined) return inferredOptionValue
        if (field.defaultValue !== undefined) return field.defaultValue
        return getOptionValue(field.options?.[0])
    }

    if (field.defaultValue !== undefined) return field.defaultValue
    if (["email", "text", "textarea"].includes(field.type || "") && isTitleLikeField(field, titleFieldName)) {
        return getSafeProposalLabel(label)
    }

    return undefined
}

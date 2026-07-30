import { createLexicalText } from "../schema/normalize.js"
import { containerNormalizers } from "./containerNormalization.js"
import { getFieldOptionValues, inferOptionValueFromText } from "./optionInference.js"
import { normalizeRelationshipValue } from "./relationshipNormalization.js"
import type { NormalizeFieldValueArgs } from "./normalizationTypes.js"

type FieldNormalizer = (args: NormalizeFieldValueArgs) => unknown

const normalizeCheckbox: FieldNormalizer = ({ issues, path, value }) => {
    if (typeof value === "boolean") return value
    if (value === "true") return true
    if (value === "false") return false

    issues.push({
        code: "invalid_checkbox",
        message: "Checkbox fields must use true or false.",
        path,
    })
    return undefined
}

const normalizeOption: FieldNormalizer = ({ coercedFields, field, inferenceText, issues, label, path, value }) => {
    const optionValues = getFieldOptionValues(field)
    const stringValue = value === null ? "" : String(value)
    const inferredOptionValue = inferOptionValueFromText({
        field,
        requireFieldMention: true,
        text: inferenceText || label,
    })

    if (inferredOptionValue && optionValues.includes(inferredOptionValue)) {
        if (stringValue !== inferredOptionValue) coercedFields.push(path)
        return inferredOptionValue
    }
    if (stringValue && optionValues.includes(stringValue)) return stringValue

    issues.push({
        code: "invalid_option",
        message: `Field must use one of: ${optionValues.join(", ")}.`,
        path,
    })
    return undefined
}

const normalizeText: FieldNormalizer = ({ value }) => (value === null ? value : String(value))

const normalizeDate: FieldNormalizer = ({ issues, path, value }) => {
    const date = new Date(String(value))
    if (!Number.isNaN(date.getTime())) return date.toISOString()

    issues.push({
        code: "invalid_date",
        message: "Date fields must use a valid date value.",
        path,
    })
    return undefined
}

const normalizeRelationship: FieldNormalizer = ({ field, issues, path, value }) =>
    normalizeRelationshipValue({
        field,
        issues,
        path,
        value,
    })

const fieldNormalizers: Record<string, FieldNormalizer> = {
    ...containerNormalizers,
    checkbox: normalizeCheckbox,
    date: normalizeDate,
    email: normalizeText,
    radio: normalizeOption,
    relationship: normalizeRelationship,
    richText: ({ value }) => createLexicalText(value),
    select: normalizeOption,
    text: normalizeText,
    textarea: normalizeText,
    upload: normalizeRelationship,
}

export const normalizeFieldValue = (args: NormalizeFieldValueArgs): unknown => {
    const normalizer = args.field.type ? fieldNormalizers[args.field.type] : undefined
    return normalizer ? normalizer(args) : args.value
}

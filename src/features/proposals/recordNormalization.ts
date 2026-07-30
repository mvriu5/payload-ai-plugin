import { normalizeDataForFields, type FieldConfig } from "../schema/normalize.js"
import { normalizeFieldValue } from "./fieldNormalization.js"
import { getDefaultFieldValue, inferOptionValueFromText } from "./optionInference.js"
import type { NormalizationState, NormalizeRecordArgs } from "./normalizationTypes.js"

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
}: NormalizeRecordArgs) => {
    const normalizedData: Record<string, unknown> = {}
    const fieldsByName = new Map(fields.filter((field): field is FieldConfig & { name: string } => Boolean(field.name)).map((field) => [field.name, field]))

    for (const [key, fieldValue] of Object.entries(value)) {
        const field = fieldsByName.get(key)
        const fieldPath = path ? `${path}.${key}` : key
        if (!field) {
            issues.push({
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
            normalizeRecord: normalizeRecordForFields,
            path: fieldPath,
            titleFieldName,
            value: fieldValue,
        })
        if (normalizedValue !== undefined) normalizedData[key] = normalizedValue
    }

    if (mode === "create" || enforceRequiredChildren) {
        for (const field of fields.filter((candidate): candidate is FieldConfig & { name: string } => Boolean(candidate.name) && candidate.required === true)) {
            const fieldPath = path ? `${path}.${field.name}` : field.name
            if (normalizedData[field.name] !== undefined) continue

            const fallbackValue = allowSafeFallback
                ? getDefaultFieldValue({
                      field,
                      inferenceText,
                      label,
                      titleFieldName,
                  })
                : undefined
            if (fallbackValue !== undefined) {
                normalizedData[field.name] = fallbackValue
                continue
            }

            issues.push({
                code: "missing_required_field",
                message: "Required field is missing.",
                path: fieldPath,
            })
        }
    }

    for (const field of fields.filter((candidate): candidate is FieldConfig & { name: string } => Boolean(candidate.name))) {
        if (normalizedData[field.name] !== undefined || (field.type !== "select" && field.type !== "radio")) continue

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

export const prepareSingleLocaleData = ({
    data,
    fields,
    ...state
}: NormalizationState & {
    data: Record<string, unknown>
    fields: readonly FieldConfig[]
}) =>
    normalizeDataForFields(
        fields,
        normalizeRecordForFields({
            ...state,
            allowSafeFallback: true,
            enforceRequiredChildren: false,
            fields,
            path: "",
            value: data,
        })
    ).data

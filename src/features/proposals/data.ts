import type { LocalizedDataInput } from "./types.js"
import { isRecord } from "../../utils/data.js"
import { getSchemaFields, normalizeAuthData, type CollectionConfig, type FieldConfig } from "../schema/normalize.js"
import { prepareSingleLocaleData } from "./recordNormalization.js"
import type { ProposalMode, ProposalValidationIssue } from "./normalizationTypes.js"

export type { ProposalValidationIssue } from "./normalizationTypes.js"

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

export const prepareProposalWriteData = ({
    collectionConfig,
    data,
    inferenceText,
    label,
    localizedData,
    mode,
}: PrepareProposalDataArgs): PreparedProposalData => {
    const schemaFields = getSchemaFields(collectionConfig)
    const titleFieldName = typeof collectionConfig?.admin?.useAsTitle === "string" ? collectionConfig.admin.useAsTitle : undefined
    const issues: ProposalValidationIssue[] = []
    const coercedFields: string[] = []

    if (localizedData) {
        const localeEntries = Object.entries(localizedData)

        if (localeEntries.length === 0) {
            issues.push({
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
                issues.push({
                    code: "invalid_container",
                    message: "Each locale entry must be an object.",
                    path: `localizedData.${locale}`,
                })
                continue
            }

            normalizedLocalizedData[locale] = prepareSingleLocaleData({
                coercedFields,
                data: localeValue,
                fields: schemaFields,
                inferenceText,
                issues,
                label,
                mode,
                titleFieldName,
            })
        }

        const [firstLocale] = localeEntries[0] || []
        if (firstLocale) {
            for (const field of schemaFields.filter((candidate): candidate is FieldConfig & { name: string } => Boolean(candidate.name))) {
                if (field.localized) continue

                for (const [locale, localeValue] of Object.entries(normalizedLocalizedData)) {
                    if (locale === firstLocale || localeValue[field.name] === undefined) continue

                    issues.push({
                        code: "non_localized_field_in_secondary_locale",
                        message: "Non-localized fields may only be set in the first locale entry.",
                        path: `localizedData.${locale}.${field.name}`,
                    })
                }
            }
        }

        return {
            coercedFields,
            issues,
            localizedData: Object.fromEntries(
                Object.entries(normalizedLocalizedData).map(([locale, localeValue]) => [
                    locale,
                    normalizeAuthData(collectionConfig, {
                        coercedFields: [],
                        data: localeValue,
                        droppedFields: [],
                    }).data,
                ])
            ),
        }
    }

    const normalizedData = prepareSingleLocaleData({
        coercedFields,
        data: data || {},
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

            if (Object.keys(nestedValue).length > 0) mergedData[field.name] = nestedValue
        }
    }

    return mergedData
}

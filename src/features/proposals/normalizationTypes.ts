import type { FieldConfig } from "../schema/normalize.js"

export type ProposalMode = "create" | "update"

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

export type NormalizationState = {
    coercedFields: string[]
    inferenceText?: string
    issues: ProposalValidationIssue[]
    label: string
    mode: ProposalMode
    titleFieldName?: string
}

export type NormalizeRecordArgs = NormalizationState & {
    allowSafeFallback: boolean
    enforceRequiredChildren: boolean
    fields: readonly FieldConfig[]
    path: string
    value: Record<string, unknown>
}

type NormalizeRecord = (args: NormalizeRecordArgs) => Record<string, unknown>

export type NormalizeFieldValueArgs = NormalizationState & {
    enforceRequiredChildren: boolean
    field: FieldConfig
    normalizeRecord: NormalizeRecord
    path: string
    value: unknown
}

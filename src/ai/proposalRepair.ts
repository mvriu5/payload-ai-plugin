import type { ProposalValidationIssue } from "../payload/proposalData.js"

export const maxProposalRepairAttempts = 1

export type CompactProposalRepairIssue = {
    code: string
    hint: string
    path: string
}

type ProposalRepairTarget = {
    collection?: string
    id?: string
    slug?: string
    tool: string
}

const getIssueHint = (issue: ProposalValidationIssue) => {
    switch (issue.code) {
        case "invalid_array":
            return "Use an array of complete objects matching the child fields."
        case "invalid_block_type":
            return "Use an exact blockType from the schema."
        case "invalid_blocks":
            return "Use an array of block objects with blockType and exact field names."
        case "invalid_checkbox":
            return "Use true or false."
        case "invalid_container":
            return "Use an object matching the nested field schema."
        case "invalid_date":
            return "Use a valid date string."
        case "invalid_option":
            return issue.message
        case "invalid_relationship":
            return "Use an existing document ID or { relationTo, value } for polymorphic relationships."
        case "missing_required_field":
            return "Add the required field with a schema-compatible value."
        case "non_localized_field_in_secondary_locale":
            return "Move this field to the primary locale data."
        case "unknown_field":
            return "Remove it and use exact schema field names only."
        default:
            return issue.message
    }
}

export const compactProposalRepairIssues = (issues: ProposalValidationIssue[]): CompactProposalRepairIssue[] => {
    return issues.slice(0, 6).map((issue) => ({
        code: issue.code,
        hint: getIssueHint(issue).slice(0, 180),
        path: issue.path,
    }))
}

export const createProposalRepairKey = ({ collection, id, slug, tool }: ProposalRepairTarget) => {
    return [tool, collection || slug || "", id || ""].join(":")
}

export const createProposalRepairTracker = () => {
    const statesByTarget = new Map<
        string,
        {
            repairCallConsumed: boolean
        }
    >()

    return {
        beginCall(target: ProposalRepairTarget) {
            const state = statesByTarget.get(createProposalRepairKey(target))

            if (!state) return "initial" as const
            if (state.repairCallConsumed) return "blocked" as const

            state.repairCallConsumed = true
            return "repair" as const
        },
        registerFailure(target: ProposalRepairTarget) {
            const key = createProposalRepairKey(target)
            const state = statesByTarget.get(key)

            if (state) {
                return {
                    attempt: maxProposalRepairAttempts,
                    errorCode: "REPAIR_EXHAUSTED" as const,
                    maxAttempts: maxProposalRepairAttempts,
                    retryable: false,
                }
            }

            statesByTarget.set(key, {
                repairCallConsumed: false,
            })

            return {
                attempt: 1,
                errorCode: "INVALID_PROPOSAL_DATA" as const,
                maxAttempts: maxProposalRepairAttempts,
                retryable: true,
            }
        },
    }
}

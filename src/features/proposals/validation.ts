import { isActionProposal, isRecord } from "../../utils/data.js"
import { verifyActionProposal } from "./signing.js"
import type { ActionProposal } from "./types.js"

export type ProposalValidationError = "invalid_shape" | "invalid_signature" | "missing"

export type SignedProposalValidation =
    | {
          error: ProposalValidationError
          ok: false
          proposal?: Partial<ActionProposal>
      }
    | {
          ok: true
          proposal: ActionProposal
      }

export const validateSignedProposal = (value: unknown): SignedProposalValidation => {
    if (value === undefined || value === null) return { error: "missing", ok: false }
    if (!isRecord(value)) return { error: "invalid_shape", ok: false }
    if (!verifyActionProposal(value)) return { error: "invalid_signature", ok: false, proposal: value as Partial<ActionProposal> }
    if (!isActionProposal(value)) return { error: "invalid_shape", ok: false, proposal: value as Partial<ActionProposal> }

    return {
        ok: true,
        proposal: value,
    }
}

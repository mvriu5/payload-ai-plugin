import type { PayloadHandler } from "payload"

import { containsSensitiveData } from "../../features/sensitiveData.js"
import type { ActionProposal } from "../../features/proposals/types.js"
import { validateSignedProposal } from "../../features/proposals/validation.js"
import { getOptionalNumber, hasLocalizedData } from "../../utils/data.js"
import { logHandlerEvent } from "../../utils/logging.js"
import { readJSONBody } from "../http.js"
import type { ApplyActionBody, ApplyActionLogContext, ApplyDebugPayload } from "./types.js"

type ProposalMeta = {
    action?: unknown
    collection?: unknown
    id?: unknown
    slug?: unknown
}

type ApplyFailure = {
    debug: ApplyDebugPayload
    error: string
    logMessage: string
    proposal?: Partial<ActionProposal>
    status?: number
}

type ApplyRequestResolution =
    | {
          failure: ApplyFailure
          ok: false
      }
    | {
          context: ApplyActionLogContext
          ok: true
          proposal: ActionProposal
      }

export const getProposalLogSummary = (proposal: ActionProposal) => ({
    action: proposal.action,
    collection: "collection" in proposal ? proposal.collection : undefined,
    hasData: "data" in proposal && Boolean(proposal.data),
    hasLocalizedData: "localizedData" in proposal && Boolean(proposal.localizedData),
    id: "id" in proposal ? proposal.id : undefined,
    label: proposal.label,
    locale: proposal.locale,
    locales: "localizedData" in proposal && proposal.localizedData ? Object.keys(proposal.localizedData) : undefined,
    slug: "slug" in proposal ? proposal.slug : undefined,
})

export const getProposalMeta = (proposal?: Partial<ActionProposal>): ProposalMeta => {
    if (!proposal) return {}

    return {
        action: proposal.action,
        collection: "collection" in proposal ? proposal.collection : undefined,
        id: "id" in proposal ? proposal.id : undefined,
        slug: "slug" in proposal ? proposal.slug : undefined,
    }
}

export const createApplyDebugPayload = ({
    details,
    phase,
    proposal,
    reason,
}: {
    details?: Record<string, unknown>
    phase: ApplyDebugPayload["phase"]
    proposal?: Partial<ActionProposal>
    reason: string
}): ApplyDebugPayload => ({
    ...getProposalMeta(proposal),
    details,
    phase,
    reason,
})

const failure = ({
    details,
    error,
    logMessage,
    phase = "apply_validation",
    proposal,
    reason,
    status,
}: {
    details?: Record<string, unknown>
    error: string
    logMessage: string
    phase?: ApplyDebugPayload["phase"]
    proposal?: Partial<ActionProposal>
    reason: string
    status?: number
}): ApplyRequestResolution => ({
    failure: {
        debug: createApplyDebugPayload({
            details,
            phase,
            proposal,
            reason,
        }),
        error,
        logMessage,
        proposal,
        status,
    },
    ok: false,
})

export const resolveApplyRequest = async (req: Parameters<PayloadHandler>[0]): Promise<ApplyRequestResolution> => {
    if (!req.user) {
        return failure({
            error: "Unauthorized",
            logMessage: "AI apply blocked: unauthorized request",
            phase: "authorization",
            reason: "unauthorized",
            status: 401,
        })
    }

    const body = await readJSONBody<ApplyActionBody>(req)
    const proposalValidation = validateSignedProposal(body?.proposal)

    if (!proposalValidation.ok && proposalValidation.error === "missing") {
        return failure({
            error: "Proposal is required",
            logMessage: "AI apply blocked: missing proposal payload",
            reason: "missing_proposal",
        })
    }
    if (!proposalValidation.ok && proposalValidation.error === "invalid_signature") {
        return failure({
            error: "Proposal signature is invalid or expired.",
            logMessage: "AI apply blocked: invalid proposal signature",
            proposal: proposalValidation.proposal,
            reason: "invalid_signature",
        })
    }
    if (!proposalValidation.ok) {
        return failure({
            error: "Proposal is invalid.",
            logMessage: "AI apply blocked: invalid proposal shape",
            proposal: proposalValidation.proposal,
            reason: "invalid_proposal_shape",
        })
    }
    const proposal = proposalValidation.proposal
    if ("data" in proposal && proposal.data && containsSensitiveData(proposal.data)) {
        return failure({
            error: "Proposal contains sensitive fields and cannot be applied.",
            logMessage: "AI apply blocked: sensitive data detected in proposal data",
            proposal,
            reason: "sensitive_data_in_data",
        })
    }
    if (hasLocalizedData(proposal) && Object.values(proposal.localizedData).some((value) => containsSensitiveData(value))) {
        return failure({
            error: "Proposal contains sensitive fields and cannot be applied.",
            logMessage: "AI apply blocked: sensitive data detected in localized proposal data",
            proposal,
            reason: "sensitive_data_in_localized_data",
        })
    }

    return {
        context: {
            aiResponse: typeof body?.aiResponse === "string" && body.aiResponse.trim() ? body.aiResponse.trim() : undefined,
            prompt: typeof body?.prompt === "string" && body.prompt.trim() ? body.prompt.trim() : undefined,
            tokenUsage: body?.tokenUsage
                ? {
                      inputTokens: getOptionalNumber(body.tokenUsage.inputTokens),
                      outputTokens: getOptionalNumber(body.tokenUsage.outputTokens),
                      totalTokens: getOptionalNumber(body.tokenUsage.totalTokens),
                  }
                : undefined,
        },
        ok: true,
        proposal,
    }
}

export const createApplyFailureResponse = (req: Parameters<PayloadHandler>[0], applyFailure: ApplyFailure) => {
    logHandlerEvent(req, "warn", {
        debug: applyFailure.debug,
        msg: applyFailure.logMessage,
        proposal: getProposalMeta(applyFailure.proposal),
    })

    return Response.json(
        {
            debug: applyFailure.debug,
            error: applyFailure.error,
        },
        { status: applyFailure.status || 400 }
    )
}

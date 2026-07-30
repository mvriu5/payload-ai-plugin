import type { PayloadHandler } from "payload"

import { getLogPreview, logHandlerEvent } from "../payload/logging.js"
import { isRecord } from "../payload/shared.js"
import { applyActionProposal } from "./apply/operations.js"
import type { ApplyActionOptions } from "./apply/types.js"
import {
    createApplyDebugPayload,
    createApplyFailureResponse,
    getProposalLogSummary,
    getProposalMeta,
    resolveApplyRequest,
} from "./apply/validation.js"

export const createApplyActionHandler =
    (options: ApplyActionOptions = {}): PayloadHandler =>
    async (req) => {
        const resolution = await resolveApplyRequest(req)
        if (!resolution.ok) return createApplyFailureResponse(req, resolution.failure)

        const { context: logContext, proposal } = resolution
        const failApply = (failure: Parameters<typeof createApplyFailureResponse>[1]) => createApplyFailureResponse(req, failure)

        logHandlerEvent(req, "info", {
            msg: "AI apply started",
            promptPreview: getLogPreview(logContext.prompt),
            proposal: getProposalLogSummary(proposal),
            tokenUsage: logContext.tokenUsage,
        })

        try {
            return await applyActionProposal({
                failApply,
                logContext,
                options,
                proposal,
                req,
            })
        } catch (err) {
            const debug = createApplyDebugPayload({
                details:
                    err && typeof err === "object" && "data" in err && isRecord((err as { data?: unknown }).data)
                        ? ({ payloadError: (err as { data: Record<string, unknown> }).data } as Record<string, unknown>)
                        : undefined,
                phase: "payload_operation",
                proposal,
                reason: "payload_operation_failed",
            })
            req.payload.logger.error({
                debug,
                err,
                msg: "AI apply action failed",
                promptPreview: getLogPreview(logContext.prompt),
                proposal: getProposalMeta(proposal),
                tokenUsage: logContext.tokenUsage,
            })

            return Response.json(
                {
                    debug,
                    error: "Could not apply proposal.",
                },
                { status: 400 }
            )
        }
    }

import type { PayloadHandler } from "payload"

import type { ZodType } from "zod"

import { createProposalRepairTracker, type CompactProposalRepairIssue } from "../../features/proposals/repair.js"
import { signAIActionProposal } from "../../features/proposals/signing.js"
import type { ActionProposal } from "../../features/proposals/types.js"
import { containsSensitiveData } from "../../features/sensitiveData.js"
import {
    isCollectionActionAllowed,
    type CollectionAction,
    type ResolvedCollectionPermissionMap,
} from "../../features/collectionPermissions.js"
import { getSafeProposalLabel, hasLocalizedData } from "../../utils/data.js"
import { getLogPreview, logHandlerEvent } from "../../utils/logging.js"
import { getProposalSummary } from "./proposalTools.js"
import type { ToolFailure } from "./types.js"

type ToolDefinition<Input> = {
    description: string
    execute: (input: Input) => unknown | Promise<unknown>
    inputSchema: ZodType
}

type ToolTarget = {
    collection?: string
    id?: string
    slug?: string
}

type ToolErrorInput = ToolFailure & {
    id?: string
}

type RepairableToolErrorInput = ToolErrorInput & {
    issues: CompactProposalRepairIssue[]
}

type CollectionToolOptions<Input extends { collection: string }> = ToolDefinition<Input> & {
    action?: CollectionAction
    currentDocumentOnly?: boolean
    getDocumentID?: (input: Input) => string | undefined
    name: string
}

type ProposalToolOptions<Input> = ToolDefinition<Input> & {
    beforeRepair?: (input: Input) => unknown | null
    getRepairTarget: (input: Input) => ToolTarget
    name: string
}

export type ChatToolFactoryOptions = {
    collections?: ResolvedCollectionPermissionMap
    currentDocument?: {
        collection: string
        id: string
    }
    debug: Record<string, unknown>
    prompt: string
    req: Parameters<PayloadHandler>[0]
}

export const createChatToolFactory = ({ collections, currentDocument, debug, prompt, req }: ChatToolFactoryOptions) => {
    const proposals: ActionProposal[] = []
    const toolFailures: ToolFailure[] = []
    const proposalRepairTracker = createProposalRepairTracker()

    const registerToolFailure = (failure: ToolFailure) => {
        toolFailures.push(failure)
        logHandlerEvent(req, "warn", {
            debug,
            ...failure,
            msg: "AI tool validation failed",
            promptPreview: getLogPreview(prompt),
        })
    }

    const error = ({ collection, details, errorCode = "NON_RETRYABLE_TOOL_ERROR", message, slug, tool }: ToolErrorInput) => {
        registerToolFailure({
            collection,
            details,
            errorCode,
            message,
            retryable: false,
            slug,
            tool,
        })

        return {
            error: message,
            errorCode,
            retryable: false,
        }
    }

    const repairableError = ({ collection, details, id, issues, message, slug, tool }: RepairableToolErrorInput) => {
        const repair = proposalRepairTracker.registerFailure({
            collection,
            id,
            slug,
            tool,
        })
        const responseMessage = repair.retryable
            ? message
            : "The single proposal repair attempt failed. Do not call the same proposal tool for this target again."
        registerToolFailure({
            collection,
            details,
            errorCode: repair.errorCode,
            message: responseMessage,
            retryable: repair.retryable,
            slug,
            tool,
        })

        return {
            error: responseMessage,
            errorCode: repair.errorCode,
            repair: {
                attempt: repair.attempt,
                issues,
                maxAttempts: repair.maxAttempts,
            },
            retryable: repair.retryable,
        }
    }

    const getRepairLimitError = ({ collection, id, slug, tool }: ToolTarget & { tool: string }) => {
        const callState = proposalRepairTracker.beginCall({
            collection,
            id,
            slug,
            tool,
        })

        if (callState !== "blocked") return null

        return error({
            collection,
            errorCode: "REPAIR_EXHAUSTED",
            message: "The single proposal repair attempt was already used. Do not call this proposal tool for the same target again.",
            slug,
            tool,
        })
    }

    const addProposal = <Proposal extends ActionProposal>(proposal: Proposal) => {
        const containsSensitiveProposalData =
            ("data" in proposal && proposal.data && containsSensitiveData(proposal.data)) ||
            ("localizedData" in proposal &&
                hasLocalizedData(proposal.localizedData) &&
                Object.values(proposal.localizedData).some((value) => containsSensitiveData(value)))

        if (containsSensitiveProposalData) {
            return error({
                details: getProposalSummary(proposal),
                message: "Proposal contains sensitive fields and cannot be created.",
                tool: `propose${proposal.action[0]?.toUpperCase()}${proposal.action.slice(1)}`,
            })
        }

        const signedProposal = signAIActionProposal(proposal)

        proposals.push(signedProposal)
        logHandlerEvent(req, "info", {
            debug,
            msg: "AI proposal created",
            proposal: getProposalSummary(signedProposal),
        })
        return signedProposal
    }

    const collectionTool = <Input extends { collection: string }>({
        action,
        currentDocumentOnly,
        description,
        execute,
        getDocumentID,
        inputSchema,
        name,
    }: CollectionToolOptions<Input>): ToolDefinition<Input> => ({
        description,
        inputSchema,
        execute: async (input) => {
            if (currentDocumentOnly) {
                const id = getDocumentID?.(input)
                if (!currentDocument || input.collection !== currentDocument.collection || id !== currentDocument.id) {
                    return error({
                        collection: input.collection,
                        message: `Only the current document can be ${action === "read" ? "read" : `${action}d`} in this context.`,
                        tool: name,
                    })
                }
            }

            if (
                action &&
                !isCollectionActionAllowed({
                    action,
                    permissions: collections,
                    req,
                    slug: input.collection,
                })
            ) {
                return error({
                    collection: input.collection,
                    message: `${action} is not enabled for collection: ${input.collection}`,
                    tool: "collectionPermissionCheck",
                })
            }

            return execute(input)
        },
    })

    const proposalTool = <Input>({
        beforeRepair,
        description,
        execute,
        getRepairTarget,
        inputSchema,
        name,
    }: ProposalToolOptions<Input>): ToolDefinition<Input> => ({
        description,
        inputSchema,
        execute: async (input) => {
            const validationError = beforeRepair?.(input)
            if (validationError) return validationError

            const repairLimitError = getRepairLimitError({
                ...getRepairTarget(input),
                tool: name,
            })
            if (repairLimitError) return repairLimitError

            return execute(input)
        },
    })

    const proposalCollectionTool = <Input extends { collection: string }>(
        options: CollectionToolOptions<Input> & Pick<ProposalToolOptions<Input>, "beforeRepair" | "getRepairTarget">
    ) =>
        collectionTool({
            ...options,
            ...proposalTool(options),
        })

    return {
        addProposal,
        collectionTool,
        error,
        proposalCollectionTool,
        proposalTool,
        proposals,
        repairableError,
        toolFailures,
    }
}

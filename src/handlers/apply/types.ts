import type { ResolvedCollectionPermissionMap } from "../../features/collectionPermissions.js"
import type { ActionProposal } from "../../features/proposals/types.js"

export type ApplyActionBody = {
    aiResponse?: string
    tokenUsage?: {
        inputTokens?: unknown
        outputTokens?: unknown
        totalTokens?: unknown
    }
    prompt?: string
    proposal?: ActionProposal
}

export type ApplyActionOptions = {
    changeLogCollection?: string
    collections?: ResolvedCollectionPermissionMap
}

export type ApplyActionLogContext = {
    aiResponse?: string
    prompt?: string
    tokenUsage?: {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
    }
}

export type ApplyDebugPayload = {
    action?: unknown
    collection?: unknown
    details?: Record<string, unknown>
    id?: unknown
    phase: "apply_validation" | "authorization" | "payload_operation"
    reason: string
    slug?: unknown
}

import type { AIRequestOptions } from "../../features/providers/requestContext.js"
import type { ResolvedCollectionPermissionMap } from "../../features/collectionPermissions.js"
import type { ChatMention } from "../../features/schema/context.js"

export type ChatMediaAttachment = {
    collection?: string
    filename?: string
    filesize?: number
    id?: string
    mimeType?: string
    type?: "media"
    url?: string
}

export type ChatBody = {
    attachments?: ChatMediaAttachment[]
    documentScope?:
        | {
              collection?: string
              id?: string
              type?: "collection"
          }
        | {
              slug?: string
              type?: "global"
          }
    mentions?: ChatMention[]
    model?: string
    prompt?: string
    provider?: string
}

export type ChatDebug = {
    model: string
    provider: string
    tools: string[]
}

export type ToolFailure = {
    collection?: string
    details?: Record<string, unknown>
    errorCode?: string
    message: string
    retryable?: boolean
    slug?: string
    tool: string
}

export type TokenUsage = {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}

export type ChatOptions = AIRequestOptions & {
    collections?: ResolvedCollectionPermissionMap
    maxOutputTokens?: number
    promptCaching?: boolean
}

export type ChatIntent = "create" | "delete" | "read" | "search" | "update" | "updateGlobal"

export type ProposalToolName = "proposeCreateDoc" | "proposeDeleteDoc" | "proposeUpdateDoc" | "proposeUpdateGlobal"

export type ToolChoice = {
    toolName: ProposalToolName
    type: "tool"
}

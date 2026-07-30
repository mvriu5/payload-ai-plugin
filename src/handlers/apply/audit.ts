import type { PayloadHandler } from "payload"

import { redactSensitiveData } from "../../ai/sensitiveData.js"
import type { ActionProposal } from "../../features/proposals/types.js"
import { getJSONLineKey } from "../../payload/shared.js"
import type { ApplyActionLogContext } from "./types.js"
import { getProposalMeta } from "./validation.js"

type AppliedDoc = {
    id?: unknown
}

type ChangeLogTarget = {
    after: unknown
    before: unknown
    documentID?: unknown
}

export const getAppliedDocReference = (doc: AppliedDoc | null | undefined) => {
    return doc?.id === undefined ? undefined : { id: doc.id }
}

const countDiffChanges = ({ after, before }: { after: unknown; before: unknown }) => {
    const beforeLines = JSON.stringify(before, null, 2).split("\n")
    const afterLines = JSON.stringify(after, null, 2).split("\n")
    const dp = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0) as number[])
    let additions = 0
    let removals = 0

    for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
        for (let j = afterLines.length - 1; j >= 0; j -= 1) {
            dp[i][j] = beforeLines[i] === afterLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
    }

    let beforeIndex = 0
    let afterIndex = 0

    while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
        if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        const beforeKey = getJSONLineKey(beforeLines[beforeIndex])
        const afterKey = getJSONLineKey(afterLines[afterIndex])

        if (beforeKey && beforeKey === afterKey) {
            removals += 1
            additions += 1
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        if (dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]) {
            removals += 1
            beforeIndex += 1
        } else {
            additions += 1
            afterIndex += 1
        }
    }

    removals += beforeLines.length - beforeIndex
    additions += afterLines.length - afterIndex

    return { additions, removals }
}

const getTargetURL = ({ documentID, proposal, req }: { documentID?: unknown; proposal: ActionProposal; req: Parameters<PayloadHandler>[0] }) => {
    const adminRoute = req.payload.config.routes.admin || "/admin"

    if (proposal.action === "updateGlobal") return `${adminRoute}/globals/${proposal.slug}`
    if (proposal.action === "delete") return null

    const id = proposal.action === "create" ? documentID : proposal.id

    if (!id) return null

    return `${adminRoute}/collections/${proposal.collection}/${id}`
}

const getUserID = (req: Parameters<PayloadHandler>[0]) => {
    const user = req.user as { id?: unknown } | null | undefined
    return user?.id === undefined ? undefined : String(user.id)
}

const getUserLabel = (req: Parameters<PayloadHandler>[0]) => {
    const user = req.user as
        | {
              email?: unknown
              id?: unknown
              name?: unknown
              username?: unknown
          }
        | null
        | undefined

    if (typeof user?.email === "string" && user.email) return user.email
    if (typeof user?.name === "string" && user.name) return user.name
    if (typeof user?.username === "string" && user.username) return user.username
    if (user?.id !== undefined) return String(user.id)

    return null
}

export const logAIChange = async ({
    changeLogCollection,
    context,
    target,
    proposal,
    req,
}: {
    changeLogCollection?: string
    context?: ApplyActionLogContext
    proposal: ActionProposal
    req: Parameters<PayloadHandler>[0]
    target: ChangeLogTarget
}) => {
    if (!changeLogCollection) return null

    const before = redactSensitiveData(target.before)
    const after = redactSensitiveData(target.after)
    const { additions, removals } = countDiffChanges({ after, before })
    const proposalForLog = { ...proposal } as Record<string, unknown>

    delete proposalForLog._aiSignature

    try {
        await req.payload.create({
            collection: changeLogCollection as never,
            data: {
                action: proposal.action,
                additions,
                after,
                aiResponse: context?.aiResponse,
                before,
                collection: "collection" in proposal ? proposal.collection : undefined,
                documentID: target.documentID === undefined ? undefined : String(target.documentID),
                inputTokens: context?.tokenUsage?.inputTokens,
                outputTokens: context?.tokenUsage?.outputTokens,
                prompt: context?.prompt,
                proposal: redactSensitiveData(proposalForLog),
                removals,
                slug: "slug" in proposal ? proposal.slug : undefined,
                totalTokens: context?.tokenUsage?.totalTokens,
                targetType: proposal.action === "updateGlobal" ? "global" : "collection",
                targetURL: getTargetURL({
                    documentID: target.documentID,
                    proposal,
                    req,
                }),
                title: proposal.label,
                userID: getUserID(req),
                userLabel: getUserLabel(req),
            },
            overrideAccess: true,
            req,
        })

        return {
            action: proposal.action,
            additions,
            after,
            aiResponse: context?.aiResponse || null,
            before,
            collection: "collection" in proposal ? proposal.collection : null,
            createdAt: new Date().toISOString(),
            documentID: target.documentID === undefined ? null : String(target.documentID),
            inputTokens: context?.tokenUsage?.inputTokens ?? null,
            outputTokens: context?.tokenUsage?.outputTokens ?? null,
            prompt: context?.prompt || null,
            removals,
            slug: "slug" in proposal ? proposal.slug : null,
            totalTokens: context?.tokenUsage?.totalTokens ?? null,
            targetType: proposal.action === "updateGlobal" ? "global" : "collection",
            title: proposal.label,
            userID: getUserID(req) || null,
            userLabel: getUserLabel(req),
            url: getTargetURL({
                documentID: target.documentID,
                proposal,
                req,
            }),
        }
    } catch (err) {
        req.payload.logger.error({
            err,
            msg: "AI change log entry could not be written",
            proposal: getProposalMeta(proposal),
        })

        return null
    }
}



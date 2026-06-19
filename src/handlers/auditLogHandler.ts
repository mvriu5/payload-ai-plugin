import type { PayloadHandler } from "payload"
import { getNumber, getString } from "src/payload/shared.js"

type AuditLogOptions = {
    changeLogCollection: string
}

export const createAuditLogHandler =
    (options: AuditLogOptions): PayloadHandler =>
    async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

        const result = await req.payload.find({
            collection: options.changeLogCollection as never,
            depth: 0,
            limit: 12,
            overrideAccess: false,
            req,
            sort: "-createdAt",
        })

        return Response.json({
            changes: result.docs.map((doc) => ({
                action: getString(doc.action),
                additions: getNumber(doc.additions),
                after: doc.after,
                aiResponse: getString(doc.aiResponse),
                before: doc.before,
                collection: getString(doc.collection),
                createdAt: getString(doc.createdAt),
                documentID: getString(doc.documentID),
                inputTokens: getNumber(doc.inputTokens),
                outputTokens: getNumber(doc.outputTokens),
                prompt: getString(doc.prompt),
                removals: getNumber(doc.removals),
                slug: getString(doc.slug),
                targetType: getString(doc.targetType),
                totalTokens: getNumber(doc.totalTokens),
                title: getString(doc.title) || "AI change",
                userID: getString(doc.userID),
                userLabel: getString(doc.userLabel),
                url: getString(doc.targetURL),
            })),
        })
    }

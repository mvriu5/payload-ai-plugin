import { useCallback, useEffect, useMemo, useState } from "react"
import { formatAdminURL } from "payload/shared"
import type { AppliedChange } from "../audit-log-list/AuditLogList.js"

export const useAuditLog = ({ adminRoute, apiRoute }: { adminRoute?: string; apiRoute: string }) => {
    const [appliedChanges, setAppliedChanges] = useState<AppliedChange[]>([])

    const recentChangesEndpoint = useMemo(
        () =>
            formatAdminURL({
                apiRoute,
                path: "/ai-audit-log",
            }),
        [apiRoute]
    )

    const allChangesURL = useMemo(() => `${adminRoute || "/admin"}/collections/$payload-ai-auditlog`, [adminRoute])

    const loadRecentChanges = useCallback(async () => {
        const res = await fetch(recentChangesEndpoint)

        const result = (await res.json().catch(() => null)) as {
            changes?: AppliedChange[]
        } | null

        if (res.ok && result?.changes) {
            setAppliedChanges(result.changes.slice(0, 8))
        }
    }, [recentChangesEndpoint])

    useEffect(() => {
        void loadRecentChanges().catch(() => undefined)
    }, [loadRecentChanges])

    const prependChange = useCallback((change: AppliedChange) => {
        setAppliedChanges((current) => [change, ...current].slice(0, 8))
    }, [])

    return {
        allChangesURL,
        appliedChanges,
        loadRecentChanges,
        prependChange,
        setAppliedChanges,
    }
}

import { useState } from "react"

import { ExternalLinkIcon } from "@payloadcms/ui"
import type { ActionProposal } from "./ActionToast.js"
import { DiffDialog, type ProposalDiff } from "./DiffDialog.js"
import styles from "./AuditLogList.module.css"

export type AppliedChange = {
    action?: ActionProposal["action"] | null
    additions: number
    after?: unknown
    before?: unknown
    collection?: string | null
    createdAt?: string | null
    documentID?: string | null
    inputTokens?: number | null
    outputTokens?: number | null
    removals: number
    slug?: string | null
    targetType?: string | null
    totalTokens?: number | null
    title: string
    userID?: string | null
    userLabel?: string | null
    url?: string | null
}

type AuditLogListProps = {
    allChangesURL?: string
    changes: AppliedChange[]
}

export type ActiveDiff = {
    change: AppliedChange | null
    diff: ProposalDiff
    proposal: ActionProposal
}

const getChangeProposal = (change: AppliedChange): ActionProposal => ({
    action: change.action || "update",
    collection: change.collection || undefined,
    id: change.documentID || undefined,
    label: change.title,
    slug: change.slug || undefined,
})

export const RecentChangesList = ({ allChangesURL, changes }: AuditLogListProps) => {
    const [activeDiff, setActiveDiff] = useState<ActiveDiff | null>(null)

    return (
        <aside className={styles.recentChanges}>
            <div className={styles.header}>
                <h3 className={styles.title}>Recent changes</h3>
                {allChangesURL && (
                    <a className={styles.headerGhostButton} href={allChangesURL}>
                        View all
                    </a>
                )}
            </div>
            <div className={styles.list}>
                {changes.length === 0 ? (
                    <div className={styles.empty}>No changes yet.</div>
                ) : (
                    changes.map((change, index) => (
                        <div className={styles.item} key={`${change.title}-${index}`}>
                            <div className={styles.titleRow}>
                                <div className={styles.itemTitle}>{change.title}</div>
                                {change.url && (
                                    <a className={styles.ghostButton} href={change.url} rel="noreferrer noopener" target="_blank">
                                        <ExternalLinkIcon />
                                    </a>
                                )}
                            </div>
                            <div className={styles.stats}>
                                <code className={styles.additions}>+{change.additions}</code>
                                <code className={styles.removals}>-{change.removals}</code>
                            </div>
                            <button
                                className={styles.button}
                                onClick={() => {
                                    if (change.before === undefined || change.after === undefined) {
                                        return
                                    }

                                    setActiveDiff({
                                        change,
                                        diff: {
                                            after: change.after,
                                            before: change.before,
                                        },
                                        proposal: getChangeProposal(change),
                                    })
                                }}
                                type="button"
                            >
                                Review
                            </button>
                        </div>
                    ))
                )}
            </div>
            {activeDiff && activeDiff.change && (
                <DiffDialog change={activeDiff.change} diff={activeDiff.diff} onClose={() => setActiveDiff(null)} proposal={activeDiff.proposal} />
            )}
        </aside>
    )
}

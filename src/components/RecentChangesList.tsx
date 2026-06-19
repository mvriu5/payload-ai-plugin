import { useState } from "react"

import { DiffDialog, type ProposalDiff } from "./DiffDialog.js"
import { FileDiff } from "./Icons.js"
import styles from "./RecentChangesList.module.css"
import type { AIActionProposal } from "./AIActionProposalList.js"
import { ExternalLinkIcon } from "@payloadcms/ui"

export type AppliedChange = {
    action?: AIActionProposal["action"] | null
    additions: number
    after?: unknown
    aiResponse?: string | null
    before?: unknown
    collection?: string | null
    createdAt?: string | null
    documentID?: string | null
    inputTokens?: number | null
    outputTokens?: number | null
    prompt?: string | null
    removals: number
    slug?: string | null
    targetType?: string | null
    totalTokens?: number | null
    title: string
    userID?: string | null
    userLabel?: string | null
    url?: string | null
}

type RecentChangesListProps = {
    changes: AppliedChange[]
}

const getChangeProposal = (change: AppliedChange): AIActionProposal => ({
    action: change.action || "update",
    collection: change.collection || undefined,
    id: change.documentID || undefined,
    label: change.title,
    slug: change.slug || undefined,
})

export const RecentChangesList = ({ changes }: RecentChangesListProps) => {
    const [activeDiff, setActiveDiff] = useState<{
        change: AppliedChange
        diff: ProposalDiff
        proposal: AIActionProposal
    } | null>(null)

    return (
        <aside className={styles.recentChanges}>
            <div className={styles.header}>
                <h3 className={styles.title}>Recent changes</h3>
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
            {activeDiff ? <DiffDialog change={activeDiff.change} diff={activeDiff.diff} onClose={() => setActiveDiff(null)} proposal={activeDiff.proposal} /> : null}
        </aside>
    )
}

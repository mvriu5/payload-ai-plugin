import { useState } from "react"

import { DiffDialog, type ProposalDiff } from "./DiffDialog.js"
import { ExternalLink, FileDiff } from "./Icons.js"
import styles from "./RecentChangesList.module.css"
import type { AIActionProposal } from "./AIActionProposalList.js"
import { ExternalLinkIcon } from "@payloadcms/ui"

export type AppliedChange = {
    action?: AIActionProposal["action"] | null
    additions: number
    after?: unknown
    before?: unknown
    collection?: string | null
    documentID?: string | null
    removals: number
    slug?: string | null
    title: string
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
                                {change.url ? (
                                    <a className={styles.ghostButton} href={change.url} rel="noreferrer noopener" target="_blank">
                                        <ExternalLinkIcon />
                                    </a>
                                ) : null}
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
                                        diff: {
                                            after: change.after,
                                            before: change.before,
                                        },
                                        proposal: getChangeProposal(change),
                                    })
                                }}
                                type="button"
                            >
                                <FileDiff height={16} width={16} />
                                Review
                            </button>
                        </div>
                    ))
                )}
            </div>
            {activeDiff ? <DiffDialog diff={activeDiff.diff} onClose={() => setActiveDiff(null)} proposal={activeDiff.proposal} /> : null}
        </aside>
    )
}

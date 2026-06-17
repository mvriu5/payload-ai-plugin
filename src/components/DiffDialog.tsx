import styles from "./DiffDialog.module.css"
import type { AIActionProposal } from "./AIActionProposalList.js"

export type ProposalDiff = {
    after: unknown
    before: unknown
}

type DiffDialogProps = {
    diff: ProposalDiff
    onClose: () => void
    proposal: AIActionProposal
}

type DiffLine = {
    changed: boolean
    placeholder?: boolean
    text: string
}

type DiffRow = {
    after: DiffLine
    before: DiffLine
}

const formatDiffValue = (value: unknown) => {
    return JSON.stringify(value, null, 2)
}

const createLine = ({ changed, placeholder = false, text = "" }: { changed: boolean; placeholder?: boolean; text?: string }): DiffLine => ({
    changed,
    placeholder,
    text,
})

const getJSONLineKey = (line: string) => {
    const match = /^(\s*)"([^"]+)":/.exec(line)

    return match ? `${match[1]}${match[2]}` : null
}

const shouldPairChangedLines = (beforeLine: string, afterLine: string) => {
    const beforeKey = getJSONLineKey(beforeLine)
    const afterKey = getJSONLineKey(afterLine)

    return Boolean(beforeKey && afterKey && beforeKey === afterKey)
}

const getDiffRows = (before: string, after: string) => {
    const beforeLines = before.split("\n")
    const afterLines = after.split("\n")
    const dp = Array.from({ length: beforeLines.length + 1 }, () => Array(afterLines.length + 1).fill(0) as number[])

    for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
        for (let j = afterLines.length - 1; j >= 0; j -= 1) {
            dp[i][j] = beforeLines[i] === afterLines[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
        }
    }

    const rows: DiffRow[] = []
    let beforeIndex = 0
    let afterIndex = 0

    while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
        if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
            rows.push({
                after: createLine({ changed: false, text: afterLines[afterIndex] }),
                before: createLine({ changed: false, text: beforeLines[beforeIndex] }),
            })
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        if (shouldPairChangedLines(beforeLines[beforeIndex], afterLines[afterIndex])) {
            rows.push({
                after: createLine({ changed: true, text: afterLines[afterIndex] }),
                before: createLine({ changed: true, text: beforeLines[beforeIndex] }),
            })
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        if (dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]) {
            rows.push({
                after: createLine({ changed: false, placeholder: true }),
                before: createLine({ changed: true, text: beforeLines[beforeIndex] }),
            })
            beforeIndex += 1
        } else {
            rows.push({
                after: createLine({ changed: true, text: afterLines[afterIndex] }),
                before: createLine({ changed: false, placeholder: true }),
            })
            afterIndex += 1
        }
    }

    while (beforeIndex < beforeLines.length) {
        rows.push({
            after: createLine({ changed: false, placeholder: true }),
            before: createLine({ changed: true, text: beforeLines[beforeIndex] }),
        })
        beforeIndex += 1
    }

    while (afterIndex < afterLines.length) {
        rows.push({
            after: createLine({ changed: true, text: afterLines[afterIndex] }),
            before: createLine({ changed: false, placeholder: true }),
        })
        afterIndex += 1
    }

    return rows
}

export const DiffDialog = ({ diff, onClose, proposal }: DiffDialogProps) => {
    const diffRows = getDiffRows(formatDiffValue(diff.before), formatDiffValue(diff.after))

    return (
        <div aria-modal="true" className={styles.dialogOverlay} role="dialog">
            <div className={styles.dialog}>
                <div className={styles.dialogHeader}>
                    <div>
                        <div className={styles.dialogTitle}>{proposal.label}</div>
                        <div className={styles.meta}>
                            {proposal.action} in {proposal.collection || proposal.slug}
                            {proposal.id ? ` #${proposal.id}` : ""}
                        </div>
                    </div>
                    <button className={styles.secondaryButton} onClick={onClose} type="button">
                        Close
                    </button>
                </div>
                <div className={styles.diffShell}>
                    <div className={styles.diffScroll}>
                        <div className={styles.diffHeaderGrid}>
                            <div className={styles.diffPaneHeader}>Current</div>
                            <div className={styles.diffPaneHeader}>Proposed</div>
                        </div>
                        <div className={styles.diffRows}>
                            {diffRows.map((row, index) => (
                                <div className={styles.diffRow} key={`row-${index}`}>
                                    <span
                                        className={[styles.diffLine, row.before.changed ? styles.diffLineRemoved : "", row.before.placeholder ? styles.diffLinePlaceholder : ""]
                                            .filter(Boolean)
                                            .join(" ")}
                                    >
                                        {row.before.text || " "}
                                    </span>
                                    <span
                                        className={[styles.diffLine, row.after.changed ? styles.diffLineAdded : "", row.after.placeholder ? styles.diffLinePlaceholder : ""].filter(Boolean).join(" ")}
                                    >
                                        {row.after.text || " "}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

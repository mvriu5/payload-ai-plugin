import { XIcon } from "@payloadcms/ui/icons/X"
import type { CSSProperties } from "react"
import { useEffect, useRef, useState } from "react"

import { getJSONLineKey } from "../../payload/shared.js"
import styles from "./DiffDialog.module.css"
import type { ActionProposal } from "../action-toast/ActionToast.js"
import type { AppliedChange } from "../audit-log-list/AuditLogList.js"

export type ProposalDiff = {
    after: unknown
    before: unknown
}

type DiffDialogProps = {
    change?: AppliedChange
    diff: ProposalDiff
    onClose: () => void
    proposal: ActionProposal
    tokenUsage?: {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
    }
}

type DiffLine = {
    changed: boolean
    path?: string
    placeholder?: boolean
    text: string
}

type CreateDiffLineInput = {
    changed: boolean
    path?: string
    placeholder?: boolean
    text?: string
}

type DiffRow = {
    after: DiffLine
    before: DiffLine
}

type DisplayDiffRow =
    | {
          index: number
          row: DiffRow
          type: "row"
      }
    | {
          count: number
          expanded: boolean
          id: string
          path?: string
          type: "collapsed"
      }

type DiffSection = {
    afterValue: string
    beforeValue: string
    id: string
    label?: string
}

const formatDiffValue = (value: unknown) => {
    return JSON.stringify(value, null, 2)
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
})

const formatDateTime = (value?: string | null) => {
    if (!value) return null

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) return value

    return dateTimeFormatter.format(date)
}

const createLine = ({ changed, path, placeholder = false, text = "" }: CreateDiffLineInput): DiffLine => ({
    changed,
    path,
    placeholder,
    text,
})

const shouldPairChangedLines = (beforeLine: string, afterLine: string) => {
    const beforeKey = getJSONLineKey(beforeLine)
    const afterKey = getJSONLineKey(afterLine)

    return Boolean(beforeKey && afterKey && beforeKey === afterKey)
}

const getJSONLinePaths = (lines: string[]) => {
    const stack: string[] = []

    return lines.map((line) => {
        const indentation = line.match(/^\s*/)?.[0].length || 0
        const level = Math.floor(indentation / 2)
        const keyMatch = /^\s*"([^"]+)":/.exec(line)

        stack.length = level

        if (keyMatch?.[1]) {
            stack[level] = keyMatch[1]
            return stack.slice(0, level + 1).join(".")
        }

        return stack.slice(0, level).join(".")
    })
}

const getRowPath = (row: DiffRow) => {
    return row.after.path || row.before.path
}

const isChangedRow = (row: DiffRow) => {
    return row.before.changed || row.after.changed
}

const buildDisplayRows = (rows: DiffRow[], expandedGroups: Set<string>, groupPrefix = "") => {
    const displayRows: DisplayDiffRow[] = []
    const contextRows = 2
    let index = 0

    while (index < rows.length) {
        if (isChangedRow(rows[index])) {
            displayRows.push({ index, row: rows[index], type: "row" })
            index += 1
            continue
        }

        const start = index

        while (index < rows.length && !isChangedRow(rows[index])) {
            index += 1
        }

        const end = index
        const count = end - start
        const groupID = `${start}-${end}`

        if (count <= contextRows * 2 + 2) {
            for (let rowIndex = start; rowIndex < end; rowIndex += 1) {
                displayRows.push({ index: rowIndex, row: rows[rowIndex], type: "row" })
            }
            continue
        }

        const scopedGroupID = groupPrefix ? `${groupPrefix}:${groupID}` : groupID
        const isExpanded = expandedGroups.has(scopedGroupID)

        for (let rowIndex = start; rowIndex < start + contextRows; rowIndex += 1) {
            displayRows.push({ index: rowIndex, row: rows[rowIndex], type: "row" })
        }

        displayRows.push({
            count: count - contextRows * 2,
            expanded: isExpanded,
            id: groupID,
            path: getRowPath(rows[start + contextRows]),
            type: "collapsed",
        })

        if (isExpanded) {
            for (let rowIndex = start + contextRows; rowIndex < end - contextRows; rowIndex += 1) {
                displayRows.push({ index: rowIndex, row: rows[rowIndex], type: "row" })
            }
        }

        for (let rowIndex = end - contextRows; rowIndex < end; rowIndex += 1) {
            displayRows.push({ index: rowIndex, row: rows[rowIndex], type: "row" })
        }
    }

    return displayRows
}

const getDiffRows = (before: string, after: string) => {
    const beforeLines = before.split("\n")
    const afterLines = after.split("\n")
    const beforeLinePaths = getJSONLinePaths(beforeLines)
    const afterLinePaths = getJSONLinePaths(afterLines)
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
                after: createLine({ changed: false, path: afterLinePaths[afterIndex], text: afterLines[afterIndex] }),
                before: createLine({ changed: false, path: beforeLinePaths[beforeIndex], text: beforeLines[beforeIndex] }),
            })
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        if (shouldPairChangedLines(beforeLines[beforeIndex], afterLines[afterIndex])) {
            rows.push({
                after: createLine({ changed: true, path: afterLinePaths[afterIndex], text: afterLines[afterIndex] }),
                before: createLine({ changed: true, path: beforeLinePaths[beforeIndex], text: beforeLines[beforeIndex] }),
            })
            beforeIndex += 1
            afterIndex += 1
            continue
        }

        if (dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]) {
            rows.push({
                after: createLine({ changed: false, placeholder: true }),
                before: createLine({ changed: true, path: beforeLinePaths[beforeIndex], text: beforeLines[beforeIndex] }),
            })
            beforeIndex += 1
        } else {
            rows.push({
                after: createLine({ changed: true, path: afterLinePaths[afterIndex], text: afterLines[afterIndex] }),
                before: createLine({ changed: false, placeholder: true }),
            })
            afterIndex += 1
        }
    }

    while (beforeIndex < beforeLines.length) {
        rows.push({
            after: createLine({ changed: false, placeholder: true }),
            before: createLine({ changed: true, path: beforeLinePaths[beforeIndex], text: beforeLines[beforeIndex] }),
        })
        beforeIndex += 1
    }

    while (afterIndex < afterLines.length) {
        rows.push({
            after: createLine({ changed: true, path: afterLinePaths[afterIndex], text: afterLines[afterIndex] }),
            before: createLine({ changed: false, placeholder: true }),
        })
        afterIndex += 1
    }

    return rows
}

const isLocaleDiffMap = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false

    return Object.values(value).every((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
}

const getDiffSections = (diff: ProposalDiff): DiffSection[] => {
    if (isLocaleDiffMap(diff.before) && isLocaleDiffMap(diff.after)) {
        const beforeByLocale = diff.before
        const afterByLocale = diff.after
        const localeKeys = Array.from(new Set([...Object.keys(beforeByLocale), ...Object.keys(afterByLocale)]))

        return localeKeys.map((locale) => ({
            afterValue: formatDiffValue(afterByLocale[locale] ?? {}),
            beforeValue: formatDiffValue(beforeByLocale[locale] ?? {}),
            id: locale,
            label: `Locale: ${locale}`,
        }))
    }

    return [
        {
            afterValue: formatDiffValue(diff.after),
            beforeValue: formatDiffValue(diff.before),
            id: "default",
        },
    ]
}

const formatTokenUsage = (value?: number | null) => {
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value.toLocaleString() : null
}

export const DiffDialog = ({ change, diff, onClose, proposal, tokenUsage }: DiffDialogProps) => {
    const [scrollLeft, setScrollLeft] = useState(0)
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set())
    const diffSections = getDiffSections(diff)
    const totalTokens = formatTokenUsage(change?.totalTokens) || formatTokenUsage(tokenUsage?.totalTokens)
    const inputTokens = formatTokenUsage(change?.inputTokens) || formatTokenUsage(tokenUsage?.inputTokens)
    const outputTokens = formatTokenUsage(change?.outputTokens) || formatTokenUsage(tokenUsage?.outputTokens)

    const dialogRef = useRef<HTMLDialogElement>(null)

    useEffect(() => {
        const dialog = dialogRef.current
        if (!dialog) return

        if (!dialog.open) {
            if (typeof dialog.showModal === "function") {
                dialog.showModal()
            } else {
                dialog.setAttribute("open", "")
            }
        }

        return () => {
            if (!dialog.open) return

            if (typeof dialog.close === "function") {
                dialog.close()
            } else {
                dialog.removeAttribute("open")
            }
        }
    }, [])

    return (
        <dialog
            aria-labelledby="payload-ai-diff-dialog-title"
            className={styles.dialogOverlay}
            onCancel={(event) => {
                event.preventDefault()
                onClose()
            }}
            ref={dialogRef}
        >
            <div className={styles.dialog}>
                <div className={styles.dialogHeader}>
                    <div>
                        <div className={styles.dialogTitle} id="payload-ai-diff-dialog-title">
                            {proposal.label}
                        </div>
                        <div className={styles.meta}>
                            {proposal.action} in {proposal.collection || proposal.slug}
                            {proposal.id ? ` #${proposal.id}` : ""}
                        </div>
                    </div>
                    <button aria-label="Close" className={styles.closeButton} onClick={onClose} type="button">
                        <XIcon />
                    </button>
                </div>
                <div className={styles.dialogContent}>
                    {change ? (
                        <div className={styles.detailSection}>
                            <div className={styles.detailGrid}>
                                <span className={styles.detailLabel}>User</span>
                                <span className={styles.detailValue}>{change.userLabel || change.userID || "Unknown"}</span>

                                <span className={styles.detailLabel}>Date</span>
                                <span className={styles.detailValue}>{formatDateTime(change.createdAt) || "Unknown"}</span>

                                {totalTokens && (
                                    <>
                                        <span className={styles.detailLabel}>Tokens</span>
                                        <span className={styles.detailValue}>
                                            {totalTokens}
                                            {inputTokens && outputTokens ? ` (${inputTokens} in / ${outputTokens} out)` : ""}
                                        </span>
                                    </>
                                )}
                            </div>
                        </div>
                    ) : (
                        totalTokens && (
                            <div className={styles.detailSection}>
                                <div className={styles.detailGrid}>
                                    <span className={styles.detailLabel}>Tokens</span>
                                    <span className={styles.detailValue}>
                                        {totalTokens}
                                        {inputTokens && outputTokens ? ` (${inputTokens} in / ${outputTokens} out)` : ""}
                                    </span>
                                </div>
                            </div>
                        )
                    )}
                    {diffSections.map((section) => {
                        const diffRows = getDiffRows(section.beforeValue, section.afterValue)
                        const displayRows = buildDisplayRows(diffRows, expandedGroups, section.id)
                        const longestLineLength = Math.max(
                            ...section.beforeValue.split("\n").map((line) => line.length),
                            ...section.afterValue.split("\n").map((line) => line.length),
                            80
                        )
                        const diffShellStyle = {
                            "--diff-line-offset": `-${scrollLeft}px`,
                            "--diff-line-width": `${longestLineLength + 8}ch`,
                        } as CSSProperties

                        return (
                            <div className={styles.diffSection} key={section.id}>
                                {section.label ? <div className={styles.diffSectionLabel}>{section.label}</div> : null}
                                <div className={styles.diffShell} style={diffShellStyle}>
                                    <div className={styles.diffScroll}>
                                        <div className={styles.diffHeaderGrid}>
                                            <div className={styles.diffPaneHeader}>Current</div>
                                            <div className={styles.diffPaneHeader}>Proposed</div>
                                        </div>
                                        <div className={styles.diffRows}>
                                            {displayRows.map((displayRow) => {
                                                if (displayRow.type === "collapsed") {
                                                    return (
                                                        <button
                                                            className={styles.diffCollapsedRow}
                                                            key={`${section.id}-collapsed-${displayRow.id}`}
                                                            onClick={() => {
                                                                setExpandedGroups((current) => {
                                                                    const next = new Set(current)
                                                                    const groupID = `${section.id}:${displayRow.id}`

                                                                    if (displayRow.expanded) {
                                                                        next.delete(groupID)
                                                                    } else {
                                                                        next.add(groupID)
                                                                    }

                                                                    return next
                                                                })
                                                            }}
                                                            type="button"
                                                        >
                                                            {displayRow.expanded ? "Hide" : "Show"} {displayRow.count} unchanged lines
                                                            {displayRow.path && <span className={styles.diffCollapsedPath}>{displayRow.path}</span>}
                                                        </button>
                                                    )
                                                }

                                                const row = displayRow.row

                                                return (
                                                    <div className={styles.diffRow} key={`${section.id}-row-${displayRow.index}`}>
                                                        <span
                                                            className={[
                                                                styles.diffLine,
                                                                row.before.changed && styles.diffLineRemoved,
                                                                row.before.placeholder && styles.diffLinePlaceholder,
                                                            ]
                                                                .filter(Boolean)
                                                                .join(" ")}
                                                        >
                                                            {row.before.changed && row.before.path && (
                                                                <span className={styles.diffPathBadge}>{row.before.path}</span>
                                                            )}
                                                            <span className={styles.diffLineContent}>{row.before.text || " "}</span>
                                                        </span>
                                                        <span
                                                            className={[
                                                                styles.diffLine,
                                                                row.after.changed && styles.diffLineAdded,
                                                                row.after.placeholder && styles.diffLinePlaceholder,
                                                            ]
                                                                .filter(Boolean)
                                                                .join(" ")}
                                                        >
                                                            {row.after.changed && row.after.path && (
                                                                <span className={styles.diffPathBadge}>{row.after.path}</span>
                                                            )}
                                                            <span className={styles.diffLineContent}>{row.after.text || " "}</span>
                                                        </span>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    </div>
                                    <div className={styles.horizontalScroll} onScroll={(event) => setScrollLeft(event.currentTarget.scrollLeft)}>
                                        <div className={styles.horizontalScrollSpacer} />
                                    </div>
                                </div>
                            </div>
                        )
                    })}
                </div>
            </div>
        </dialog>
    )
}

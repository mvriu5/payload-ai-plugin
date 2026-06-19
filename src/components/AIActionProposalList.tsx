import styles from "./AIActionProposalList.module.css"
import { redactSensitiveData } from "../ai/sensitiveData.js"
import { formatAdminURL } from "payload/shared"
import { useState } from "react"
import { DiffDialog, type ProposalDiff } from "./DiffDialog.js"
import { Apply, FileDiff, Reject } from "./Icons.js"

export type AIActionProposal = {
    _aiSignature?: {
        expiresAt: string
        value: string
    }
    action: "create" | "delete" | "update" | "updateGlobal"
    collection?: string
    data?: Record<string, unknown>
    id?: string
    label: string
    locale?: string
    localizedData?: Record<string, Record<string, unknown>>
    slug?: string
}

type AIActionProposalListProps = {
    apiRoute: string
    appliedProposalIndexes: number[]
    description?: string
    error?: string
    getViewURL?: (proposal: AIActionProposal) => string | null
    isApplying: boolean
    onDismiss?: () => void
    onDismissError?: () => void
    onApply: (proposal: AIActionProposal, index: number) => void
    proposals: AIActionProposal[]
    tokenUsage?: {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
    } | null
}

const maxDescriptionLength = 220

const getDescriptionPreview = (description: string) => {
    if (description.length <= maxDescriptionLength) return description
    return `${description.slice(0, maxDescriptionLength).trim()}...`
}

const getSafeProposalDetails = (proposal: AIActionProposal) => {
    const redactedProposal = redactSensitiveData(proposal) as AIActionProposal

    if (redactedProposal._aiSignature) {
        redactedProposal._aiSignature = {
            expiresAt: redactedProposal._aiSignature.expiresAt,
            value: "[redacted]",
        }
    }

    return redactedProposal
}

export const AIActionProposalList = ({ apiRoute, appliedProposalIndexes, description, error, getViewURL, isApplying, onDismiss, onDismissError, onApply, proposals, tokenUsage }: AIActionProposalListProps) => {
    const [activeDiff, setActiveDiff] = useState<{
        diff: ProposalDiff
        proposal: AIActionProposal
    } | null>(null)
    const [diffError, setDiffError] = useState("")
    const [loadingDiffIndex, setLoadingDiffIndex] = useState<number | null>(null)

    if (proposals.length === 0 && !error && !description) return null
    const descriptionPreview = description ? getDescriptionPreview(description) : ""
    const isDescriptionTruncated = Boolean(description) && descriptionPreview !== description

    const openDiff = async (proposal: AIActionProposal, index: number) => {
        setDiffError("")
        setLoadingDiffIndex(index)

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute,
                    path: "/ai-proposal-diff",
                }),
                {
                    body: JSON.stringify({ proposal }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                }
            )
            const result = (await res.json().catch(() => null)) as (ProposalDiff & { error?: string }) | null

            if (!res.ok || !result) {
                throw new Error(result?.error || "Could not load proposal diff.")
            }

            setActiveDiff({
                diff: {
                    after: result.after,
                    before: result.before,
                },
                proposal,
            })
        } catch (err) {
            setDiffError(err instanceof Error ? err.message : "Could not load proposal diff.")
        } finally {
            setLoadingDiffIndex(null)
        }
    }

    return (
        <div className={styles.list}>
            {error && (
                <div className={`${styles.item} ${styles.errorItem}`}>
                    <div>
                        <div className={styles.label}>AI request failed</div>
                        <div className={styles.description}>{error}</div>
                    </div>
                    {onDismissError && (
                        <button className={styles.button} onClick={onDismissError} type="button">
                            Dismiss
                        </button>
                    )}
                </div>
            )}
            {!error && proposals.length === 0 && description && (
                <div className={styles.item}>
                    <div>
                        <div className={styles.label}>AI response</div>
                        <div className={styles.description}>{descriptionPreview}</div>
                        {isDescriptionTruncated ? (
                            <details className={styles.details}>
                                <summary className={styles.summary}>Full response</summary>
                                <pre className={styles.proposalDetails}>{description}</pre>
                            </details>
                        ) : null}
                    </div>
                </div>
            )}
            {proposals.map((proposal, index) => {
                const isApplied = appliedProposalIndexes.includes(index)
                const viewURL = getViewURL?.(proposal)

                return (
                    <div className={styles.item} key={`${proposal.action}-${index}`}>
                        <div className={styles.content}>
                            <div className={styles.label}>{proposal.label}</div>
                            <div className={styles.meta}>
                                {proposal.action} in {proposal.collection || proposal.slug}
                                {proposal.id ? ` #${proposal.id}` : ""}
                            </div>
                            {description && <div className={styles.description}>{descriptionPreview}</div>}
                            {description && isDescriptionTruncated && (
                                <details className={styles.details}>
                                    <summary className={styles.summary}>Full response</summary>
                                    <pre className={styles.proposalDetails}>{description}</pre>
                                </details>
                            )}
                            <details className={styles.details}>
                                <summary className={styles.summary}>Details</summary>
                                <pre className={styles.proposalDetails}>{JSON.stringify(getSafeProposalDetails(proposal), null, 2)}</pre>
                            </details>
                        </div>
                        <div className={styles.footer}>
                            <div className={styles.viewAction}>
                                <button className={styles.secondaryButton} disabled={loadingDiffIndex === index} onClick={() => void openDiff(proposal, index)} type="button">
                                    <FileDiff height={16} width={16} />
                                    {loadingDiffIndex === index ? "Loading" : "Review"}
                                </button>
                                {viewURL && (
                                    <a className={styles.ghostButton} href={viewURL} rel="noreferrer noopener" target="_blank">
                                        Go to source
                                    </a>
                                )}
                            </div>
                            <div className={styles.actions}>
                                {onDismiss && (
                                    <button className={styles.secondaryButton} onClick={onDismiss} type="button">
                                        <Reject height={16} width={16} />
                                    </button>
                                )}
                                <button className={styles.button} disabled={isApplying || isApplied} onClick={() => onApply(proposal, index)} type="button">
                                    <Apply height={16} width={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )
            })}
            {diffError ? (
                <div className={`${styles.item} ${styles.errorItem}`}>
                    <div>
                        <div className={styles.label}>Diff review failed</div>
                        <div className={styles.description}>{diffError}</div>
                    </div>
                    <button className={styles.button} onClick={() => setDiffError("")} type="button">
                        Dismiss
                    </button>
                </div>
            ) : null}
            {activeDiff ? <DiffDialog diff={activeDiff.diff} onClose={() => setActiveDiff(null)} proposal={activeDiff.proposal} tokenUsage={tokenUsage || undefined} /> : null}
        </div>
    )
}

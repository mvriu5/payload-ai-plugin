import { Button, CheckIcon, SwapIcon } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import { useState } from "react"
import { redactSensitiveData } from "../../ai/sensitiveData.js"
import type { ActiveDiff } from "../audit-log-list/AuditLogList.js"
import { DiffDialog, type ProposalDiff } from "../diff-dialog/DiffDialog.js"
import { TextShimmer } from "../text-shimmer/TextShimmer.js"
import styles from "./ActionToast.module.css"

const ACTION_TOAST_TEXT = {
    aiRequestFailed: "AI request failed",
    aiResponse: "AI response",
    applyProposal: "Apply proposal",
    details: "Details",
    diffReviewFailed: "Diff review failed",
    dismiss: "Dismiss",
    dismissProposals: "Dismiss proposals",
    fullResponse: "Full response",
    goToSource: "Go to source",
    loading: "Loading",
    proposalDiffError: "Could not load proposal diff.",
    redacted: "[redacted]",
    review: "Review",
    reviewProposal: "Review proposal",
    waitingForResponse: "Please wait, until the Response is received",
} as const

const PROPOSAL_DIFF_ENDPOINT = "/ai-proposal-diff"
const JSON_CONTENT_TYPE = "application/json"
const POST_METHOD = "POST"

export type ActionProposal = {
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

type ActionToastProps = {
    apiRoute: string
    description?: string
    error?: string
    getViewURL?: (proposal: ActionProposal) => string | null
    isApplying: boolean
    isLoading: boolean
    onDismiss?: () => void
    onDismissError?: () => void
    onApply: (proposal: ActionProposal, index: number) => void
    prompt?: string
    proposals: ActionProposal[]
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

const getSafeProposalDetails = (proposal: ActionProposal) => {
    const redactedProposal = redactSensitiveData(proposal) as ActionProposal

    if (redactedProposal._aiSignature) {
        redactedProposal._aiSignature = {
            expiresAt: redactedProposal._aiSignature.expiresAt,
            value: ACTION_TOAST_TEXT.redacted,
        }
    }

    return redactedProposal
}

export const ActionToast = ({
    apiRoute,
    description,
    error,
    getViewURL,
    isApplying,
    isLoading,
    onDismiss,
    onDismissError,
    onApply,
    prompt,
    proposals,
    tokenUsage,
}: ActionToastProps) => {
    const [activeDiff, setActiveDiff] = useState<ActiveDiff | null>(null)
    const [diffError, setDiffError] = useState("")
    const [loadingDiffIndex, setLoadingDiffIndex] = useState<number | null>(null)

    if (proposals.length === 0 && !error && !description && !isLoading) return null

    const descriptionPreview = description ? getDescriptionPreview(description) : ""
    const isDescriptionTruncated = Boolean(description) && descriptionPreview !== description

    const openDiff = async (proposal: ActionProposal, index: number) => {
        setDiffError("")
        setLoadingDiffIndex(index)

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute,
                    path: PROPOSAL_DIFF_ENDPOINT,
                }),
                {
                    body: JSON.stringify({ proposal, prompt }),
                    headers: { "Content-Type": JSON_CONTENT_TYPE },
                    method: POST_METHOD,
                }
            )
            const result = (await res.json().catch(() => null)) as (ProposalDiff & { error?: string }) | null

            if (!res.ok || !result) {
                throw new Error(result?.error || ACTION_TOAST_TEXT.proposalDiffError)
            }

            setActiveDiff({
                change: null,
                diff: {
                    after: result.after,
                    before: result.before,
                },
                proposal,
            })
        } catch (err) {
            setDiffError(err instanceof Error ? err.message : ACTION_TOAST_TEXT.proposalDiffError)
        } finally {
            setLoadingDiffIndex(null)
        }
    }

    return (
        <div className={styles.list}>
            {proposals.length === 0 && isLoading && (
                <div className={styles.item}>
                    <div className={styles.label}>{ACTION_TOAST_TEXT.aiResponse}</div>
                    <div className={styles.description}>
                        <TextShimmer>{ACTION_TOAST_TEXT.waitingForResponse}</TextShimmer>
                    </div>
                </div>
            )}
            {error && (
                <div className={`${styles.item} ${styles.errorItem}`}>
                    <div>
                        <div className={styles.label}>{ACTION_TOAST_TEXT.aiRequestFailed}</div>
                        <div className={styles.description}>{error}</div>
                    </div>
                    {onDismissError && (
                        <button className={styles.button} onClick={onDismissError} type="button">
                            {ACTION_TOAST_TEXT.dismiss}
                        </button>
                    )}
                </div>
            )}
            {!error && proposals.length === 0 && description && (
                <div className={styles.item}>
                    <div>
                        <div className={styles.label}>{ACTION_TOAST_TEXT.aiResponse}</div>
                        <div className={styles.description}>{descriptionPreview}</div>
                        {isDescriptionTruncated && (
                            <details className={styles.details}>
                                <summary className={styles.summary}>{ACTION_TOAST_TEXT.fullResponse}</summary>
                                <pre className={styles.proposalDetails}>{description}</pre>
                            </details>
                        )}
                    </div>
                </div>
            )}
            {proposals.map((proposal, index) => {
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
                                    <summary className={styles.summary}>{ACTION_TOAST_TEXT.fullResponse}</summary>
                                    <pre className={styles.proposalDetails}>{description}</pre>
                                </details>
                            )}
                            <details className={styles.details}>
                                <summary className={styles.summary}>{ACTION_TOAST_TEXT.details}</summary>
                                <pre className={styles.proposalDetails}>{JSON.stringify(getSafeProposalDetails(proposal), null, 2)}</pre>
                            </details>
                        </div>
                        <div className={styles.footer}>
                            <div className={styles.viewAction}>
                                <Button
                                    aria-label={`${ACTION_TOAST_TEXT.reviewProposal}: ${proposal.label}`}
                                    margin={false}
                                    buttonStyle="subtle"
                                    disabled={loadingDiffIndex === index}
                                    onClick={() => void openDiff(proposal, index)}
                                >
                                    <SwapIcon />
                                    {loadingDiffIndex === index ? ACTION_TOAST_TEXT.loading : ACTION_TOAST_TEXT.review}
                                </Button>
                                {viewURL && (
                                    <Button el="anchor" buttonStyle="tab" url={viewURL} newTab margin={false}>
                                        {ACTION_TOAST_TEXT.goToSource}
                                    </Button>
                                )}
                            </div>
                            <div className={styles.actions}>
                                {onDismiss && (
                                    <Button icon="x" aria-label={ACTION_TOAST_TEXT.dismissProposals} buttonStyle="subtle" margin={false} onClick={onDismiss} />
                                )}
                                <Button
                                    aria-label={`${ACTION_TOAST_TEXT.applyProposal}: ${proposal.label}`}
                                    margin={false}
                                    buttonStyle="primary"
                                    disabled={isApplying}
                                    onClick={() => onApply(proposal, index)}
                                >
                                    <CheckIcon />
                                </Button>
                            </div>
                        </div>
                    </div>
                )
            })}
            {diffError && (
                <div className={`${styles.item} ${styles.errorItem}`}>
                    <div>
                        <div className={styles.label}>{ACTION_TOAST_TEXT.diffReviewFailed}</div>
                        <div className={styles.description}>{diffError}</div>
                    </div>
                    <button className={styles.button} onClick={() => setDiffError("")} type="button">
                        {ACTION_TOAST_TEXT.dismiss}
                    </button>
                </div>
            )}
            {activeDiff && (
                <DiffDialog diff={activeDiff.diff} onClose={() => setActiveDiff(null)} proposal={activeDiff.proposal} tokenUsage={tokenUsage || undefined} />
            )}
        </div>
    )
}

import styles from './AIActionProposalList.module.css'

export type AIActionProposal = {
    action: 'create' | 'delete' | 'update' | 'updateGlobal'
    collection?: string
    data?: Record<string, unknown>
    id?: string
    label: string
    slug?: string
}

type AIActionProposalListProps = {
    appliedProposalIndexes: number[]
    isApplying: boolean
    onApply: (proposal: AIActionProposal, index: number) => void
    proposals: AIActionProposal[]
}

export const AIActionProposalList = ({ appliedProposalIndexes, isApplying, onApply, proposals,}: AIActionProposalListProps) => {
    if (proposals.length === 0) return null

    return (
        <div className={styles.list}>
            {proposals.map((proposal, index) => {
                const isApplied = appliedProposalIndexes.includes(index)

                return (
                    <div className={styles.item} key={`${proposal.action}-${index}`}>
                        <div>
                            <div className={styles.label}>{proposal.label}</div>
                            <div className={styles.meta}>
                                {proposal.action} in {proposal.collection || proposal.slug}
                                {proposal.id ? ` #${proposal.id}` : ''}
                            </div>
                        </div>
                        <button
                            className={styles.button}
                            disabled={isApplying || isApplied}
                            onClick={() => onApply(proposal, index)}
                            type="button"
                        >
                            {isApplied ? 'Applied' : 'Apply'}
                    </button>
                </div>
                )
            })}
        </div>
    )
}

import styles from "./AIActionProposalList.module.css";

export type AIActionProposal = {
  _aiSignature?: {
    expiresAt: string;
    value: string;
  };
  action: "create" | "delete" | "update" | "updateGlobal";
  collection?: string;
  data?: Record<string, unknown>;
  id?: string;
  label: string;
  slug?: string;
};

type AIActionProposalListProps = {
  appliedProposalIndexes: number[];
  description?: string;
  error?: string;
  errorDetails?: Record<string, unknown> | null;
  getViewURL?: (proposal: AIActionProposal) => string | null;
  isApplying: boolean;
  onDismiss?: () => void;
  onDismissError?: () => void;
  onApply: (proposal: AIActionProposal, index: number) => void;
  proposals: AIActionProposal[];
};

const maxDescriptionLength = 220;

const getDescriptionPreview = (description: string) => {
  if (description.length <= maxDescriptionLength) return description;
  return `${description.slice(0, maxDescriptionLength).trim()}...`;
};

export const AIActionProposalList = ({
  appliedProposalIndexes,
  description,
  error,
  errorDetails,
  getViewURL,
  isApplying,
  onDismiss,
  onDismissError,
  onApply,
  proposals,
}: AIActionProposalListProps) => {
  if (proposals.length === 0 && !error && !description) return null;
  const descriptionPreview = description
    ? getDescriptionPreview(description)
    : "";
  const isDescriptionTruncated =
    Boolean(description) && descriptionPreview !== description;

  return (
    <div className={styles.list}>
      {error && (
        <div className={`${styles.item} ${styles.errorItem}`}>
          <div>
            <div className={styles.label}>AI request failed</div>
            <div className={styles.description}>{error}</div>
            {errorDetails && (
              <pre className={styles.proposalDetails}>
                {JSON.stringify(errorDetails, null, 2)}
              </pre>
            )}
          </div>
          {onDismissError && (
            <button
              className={styles.button}
              onClick={onDismissError}
              type="button"
            >
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
        const isApplied = appliedProposalIndexes.includes(index);
        const viewURL = getViewURL?.(proposal);

        return (
          <div className={styles.item} key={`${proposal.action}-${index}`}>
            <div className={styles.content}>
              <div className={styles.label}>{proposal.label}</div>
              <div className={styles.meta}>
                {proposal.action} in {proposal.collection || proposal.slug}
                {proposal.id ? ` #${proposal.id}` : ""}
              </div>
              {description && (
                <div className={styles.description}>{descriptionPreview}</div>
              )}
              {description && isDescriptionTruncated && (
                <details className={styles.details}>
                  <summary className={styles.summary}>Full response</summary>
                  <pre className={styles.proposalDetails}>{description}</pre>
                </details>
              )}
              <details className={styles.details}>
                <summary className={styles.summary}>Details</summary>
                <pre className={styles.proposalDetails}>
                  {JSON.stringify(proposal, null, 2)}
                </pre>
              </details>
            </div>
            <div className={styles.footer}>
              <div className={styles.viewAction}>
                {viewURL && (
                  <a
                    className={styles.secondaryButton}
                    href={viewURL}
                    rel="noreferrer noopener"
                    target="_blank"
                  >
                    View
                  </a>
                )}
              </div>
              <div className={styles.actions}>
                {onDismiss && (
                  <button
                    className={styles.secondaryButton}
                    onClick={onDismiss}
                    type="button"
                  >
                    Dismiss
                  </button>
                )}
                <button
                  className={styles.button}
                  disabled={isApplying || isApplied}
                  onClick={() => onApply(proposal, index)}
                  type="button"
                >
                  {isApplied ? "Applied" : "Apply"}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

import styles from "./RecentChangesList.module.css";

export type AppliedChange = {
  additions: number;
  removals: number;
  title: string;
  url?: string | null;
};

type RecentChangesListProps = {
  changes: AppliedChange[];
};

export const RecentChangesList = ({ changes }: RecentChangesListProps) => {
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
              <div className={styles.itemTitle}>{change.title}</div>
              <div className={styles.stats}>
                <code className={styles.additions}>+{change.additions}</code>
                <code className={styles.removals}>-{change.removals}</code>
              </div>
              {change.url ? (
                <a
                  className={styles.button}
                  href={change.url}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  Open
                </a>
              ) : null}
            </div>
          ))
        )}
      </div>
    </aside>
  );
};

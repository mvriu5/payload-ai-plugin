import styles from './CollectionMentionBadge.module.css'

type CollectionMentionBadgeProps = {
  name: string
}

export const CollectionMentionBadge = ({ name }: CollectionMentionBadgeProps) => {
  return <span className={styles.badge}>collection: {name}</span>
}

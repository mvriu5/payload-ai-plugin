import styles from './CollectionMentionPopover.module.css'

export type CollectionMentionOption = {
    collection?: string
    id?: string
    label: string
    slug: string
    type: 'collection' | 'doc'
}

type CollectionMentionPopoverProps = {
    suggestions: CollectionMentionOption[]
    onSelect: (suggestion: CollectionMentionOption) => void
}

export const CollectionMentionPopover = ({ onSelect, suggestions }: CollectionMentionPopoverProps) => {
    if (suggestions.length === 0) return null

    return (
        <div className={styles.popover}>
            {suggestions.map((suggestion) => (
                <button
                    className={styles.option}
                    key={`${suggestion.type}-${suggestion.slug}`}
                    onMouseDown={(event) => {
                        event.preventDefault()
                        onSelect(suggestion)
                    }}
                    type="button"
                >
                    <span className={styles.slug}>
                        {suggestion.type === 'collection' ? `@${suggestion.slug}` : suggestion.label}
                    </span>
                    <span className={styles.label}>
                        {suggestion.type === 'collection' ? suggestion.label : `${suggestion.collection} document`}
                    </span>
                </button>
            ))}
        </div>
    )
}

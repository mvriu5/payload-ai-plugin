import styles from "./MentionPopover.module.css"
import type { CSSProperties } from "react"
import type { RefObject } from "react"

export type MentionOption = {
    collection?: string
    id?: string
    isDefault?: boolean
    label: string
    parent?: string
    slug: string
    type: "collection" | "doc" | "global" | "locale"
}

type MentionPopoverProps = {
    suggestions: MentionOption[]
    onSelect: (suggestion: MentionOption) => void
    style?: CSSProperties
}

const suggestionGroups: { label: string; type: MentionOption["type"] }[] = [
    {
        label: "Collections",
        type: "collection",
    },
    {
        label: "Documents",
        type: "doc",
    },
    {
        label: "Globals",
        type: "global",
    },

    {
        label: "Locales",
        type: "locale",
    },
]

const getSuggestionTitle = (suggestion: MentionOption) => {
    if (suggestion.type === "collection") return `@${suggestion.slug}`
    if (suggestion.type === "global") return `@${suggestion.slug}`

    if (suggestion.type === "locale") return `@${suggestion.slug}`
    return suggestion.label
}

const getSuggestionLabel = (suggestion: MentionOption) => {
    if (suggestion.type === "collection") return suggestion.label
    if (suggestion.type === "global") return "global"

    if (suggestion.type === "locale") return suggestion.isDefault ? "default locale" : "locale"
    return `${suggestion.collection} item`
}

export const MentionPopover = ({ onSelect, style, suggestions }: MentionPopoverProps) => {
    if (suggestions.length === 0) return null

    const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, suggestion: MentionOption) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onSelect(suggestion)
            return
        }

        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return

        const popover = event.currentTarget.closest(`.${styles.popover}`)
        if (!popover) return

        const buttons = Array.from(popover.querySelectorAll("button"))
        const currentIndex = buttons.indexOf(event.currentTarget)
        if (currentIndex === -1) return

        event.preventDefault()
        const nextIndex = event.key === "ArrowDown" ? Math.min(currentIndex + 1, buttons.length - 1) : Math.max(currentIndex - 1, 0)
        ;(buttons[nextIndex] as HTMLButtonElement | undefined)?.focus()
    }

    const onMouseDown = (event: React.MouseEvent<HTMLButtonElement>, suggestion: MentionOption) => {
        event.preventDefault()
        onSelect(suggestion)
    }

    return (
        <div className={styles.popover} style={style}>
            {suggestionGroups.map((group) => {
                const groupSuggestions = suggestions.filter((s) => s.type === group.type)
                if (groupSuggestions.length === 0) return null

                return (
                    <div className={styles.group} key={group.type}>
                        <div className={styles.groupLabel}>{group.label}</div>
                        {groupSuggestions.map((suggestion) => (
                            <button
                                className={styles.option}
                                key={`${suggestion.type}-${suggestion.slug}-${suggestion.parent || ""}-${suggestion.collection || ""}-${suggestion.id || ""}`}
                                onMouseDown={(e) => onMouseDown(e, suggestion)}
                                onKeyDown={(e) => onKeyDown(e, suggestion)}
                                type="button"
                            >
                                <span className={styles.slug}>{getSuggestionTitle(suggestion)}</span>
                                <span className={styles.label}>{getSuggestionLabel(suggestion)}</span>
                            </button>
                        ))}
                    </div>
                )
            })}
        </div>
    )
}

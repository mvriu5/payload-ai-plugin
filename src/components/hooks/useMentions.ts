"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react"

import { getSerializableLabel, isInternalCollection } from "../../payload/shared.js"
import type { MentionOption } from "../mention-popover/MentionPopover.js"
import { createBadgePrefix, getTextNodeAtOffset, replaceTextRangeWithBadge } from "../ai-input/badge.js"
import { useDocumentMentionSuggestions } from "../hooks/useDocumentMentionSuggestions.js"

export type Mention = {
    collection?: string
    id?: string
    isDefault?: boolean
    label: string
    parent?: string
    slug: string
    type: "collection" | "doc" | "global" | "locale"
}

type MentionRange = {
    end: number
    start: number
}

type FieldWithBlocks = {
    blocks?: {
        fields?: FieldWithBlocks[]
        labels?: {
            plural?: unknown
            singular?: unknown
        }
        slug: string
    }[]
    fields?: FieldWithBlocks[]
    name?: string
    type?: string
}

type LocaleConfig =
    | string
    | {
          code?: string
          label?: unknown
      }

type UseMentionPopoverArgs = {
    apiRoute: string
    config: {
        collections: Array<{
            fields: unknown[]
            labels?: {
                singular?: unknown
            }
            slug: string
        }>
        globals?: Array<{
            fields: unknown[]
            label?: unknown
            slug: string
        }>
    }
    defaultLocale?: string
    editorRef: RefObject<HTMLDivElement | null>
    isCollectionMentionEnabled: (slug: string) => boolean
    locales: LocaleConfig[]
    setPrompt: (value: string) => void
    styles: Record<string, string>
}

const isMentionBoundary = (character: string | undefined) => {
    return character === undefined || /\s/.test(character)
}

const collectBlockOptions = ({ fields, parent }: { fields: FieldWithBlocks[]; parent: string }): MentionOption[] => {
    const options: MentionOption[] = []

    for (const field of fields) {
        if (!field.fields) continue
        options.push(
            ...collectBlockOptions({
                fields: field.fields,
                parent,
            })
        )
    }

    return options
}

const getActiveMentionRange = (valueBeforeCaret: string) => {
    const caretPosition = valueBeforeCaret.length

    for (let index = valueBeforeCaret.length - 1; index >= 0; index -= 1) {
        const character = valueBeforeCaret[index]

        if (character === "@") {
            const previousCharacter = valueBeforeCaret[index - 1]
            const query = valueBeforeCaret.slice(index + 1)

            if (!isMentionBoundary(previousCharacter)) return null
            if (!/^[\w-]*$/.test(query)) return null

            return {
                query,
                range: {
                    end: caretPosition,
                    start: index,
                },
            }
        }

        if (isMentionBoundary(character)) break
    }

    return null
}

export const getTextBeforeCaret = (element: HTMLElement) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return ""

    const range = selection.getRangeAt(0)
    const clonedRange = range.cloneRange()

    clonedRange.selectNodeContents(element)
    clonedRange.setEnd(range.endContainer, range.endOffset)

    return clonedRange.toString()
}

export const useMentions = ({ apiRoute, config, defaultLocale, editorRef, isCollectionMentionEnabled, locales, setPrompt, styles }: UseMentionPopoverArgs) => {
    const mentionsRef = useRef<Mention[]>([])
    const [mentionQuery, setMentionQuery] = useState("")
    const [mentionRange, setMentionRange] = useState<MentionRange | null>(null)
    const [mentionPopoverPosition, setMentionPopoverPosition] = useState<null | {
        left: number
        top: number
    }>(null)

    const collections = useMemo<MentionOption[]>(
        () =>
            config.collections.flatMap((collection) => {
                if (isInternalCollection(collection.slug) || !isCollectionMentionEnabled(collection.slug)) return []

                return [
                    {
                        label: getSerializableLabel(collection.labels?.singular, collection.slug),
                        slug: collection.slug,
                        type: "collection" as const,
                    },
                ]
            }),
        [config.collections, isCollectionMentionEnabled]
    )

    const globals = useMemo<MentionOption[]>(
        () =>
            config.globals?.map((global) => ({
                label: getSerializableLabel(global.label, global.slug),
                slug: global.slug,
                type: "global" as const,
            })) || [],
        [config.globals]
    )

    const blocks = useMemo<MentionOption[]>(
        () => [
            ...config.collections.flatMap((collection) => {
                if (!isCollectionMentionEnabled(collection.slug)) return []

                return collectBlockOptions({
                    fields: collection.fields as FieldWithBlocks[],
                    parent: collection.slug,
                })
            }),
            ...(config.globals?.flatMap((global) =>
                collectBlockOptions({
                    fields: global.fields as FieldWithBlocks[],
                    parent: global.slug,
                })
            ) || []),
        ],
        [config.collections, config.globals, isCollectionMentionEnabled]
    )

    const localeOptions = useMemo<MentionOption[]>(
        () =>
            locales.flatMap((locale) => {
                if (typeof locale === "string") {
                    return [
                        {
                            isDefault: locale === defaultLocale,
                            label: locale,
                            slug: locale,
                            type: "locale" as const,
                        },
                    ]
                }

                if (!locale || typeof locale !== "object") return []

                const slug = typeof locale.code === "string" ? locale.code : null
                if (!slug) return []

                return [
                    {
                        isDefault: slug === defaultLocale,
                        label: getSerializableLabel(locale.label, slug),
                        slug,
                        type: "locale" as const,
                    },
                ]
            }),
        [defaultLocale, locales]
    )

    const mentionOptions = useMemo(() => [...collections, ...globals, ...blocks, ...localeOptions], [blocks, collections, globals, localeOptions])

    const normalizedMentionQuery = mentionQuery.toLowerCase()

    const filteredCollections = useMemo(
        () =>
            collections.filter(
                (collection) =>
                    collection.slug.toLowerCase().includes(normalizedMentionQuery) || collection.label.toLowerCase().includes(normalizedMentionQuery)
            ),
        [collections, normalizedMentionQuery]
    )

    const filteredMentionOptions = useMemo(
        () =>
            mentionOptions.filter(
                (option) => option.slug.toLowerCase().includes(normalizedMentionQuery) || option.label.toLowerCase().includes(normalizedMentionQuery)
            ),
        [mentionOptions, normalizedMentionQuery]
    )

    const documentSuggestionCollection = filteredCollections.length === 1 ? filteredCollections[0]?.slug : null

    const { documentSuggestions, resetDocumentSuggestions } = useDocumentMentionSuggestions({
        apiRoute,
        documentSuggestionCollection,
        mentionQuery,
        mentionRange,
    })

    const mentionSuggestions = useMemo(() => [...filteredMentionOptions, ...documentSuggestions], [documentSuggestions, filteredMentionOptions])

    const updateMentionPopoverPosition = useCallback(
        (range: MentionRange | null) => {
            const editor = editorRef.current

            if (!editor || !range) {
                setMentionPopoverPosition(null)
                return
            }

            const startPosition = getTextNodeAtOffset(editor, range.start)

            const anchorRange = document.createRange()
            anchorRange.setStart(startPosition.node, startPosition.offset)
            anchorRange.collapse(true)

            const marker = document.createElement("span")
            marker.textContent = "\u200b"

            anchorRange.insertNode(marker)

            const rect = anchorRange.getBoundingClientRect()

            marker.remove()

            if (rect.left === 0 && rect.top === 0) {
                setMentionPopoverPosition(null)
                return
            }

            setMentionPopoverPosition({
                left: rect.left,
                top: rect.bottom + 4,
            })
        },
        [editorRef]
    )

    const resetMentionState = useCallback(() => {
        setMentionQuery("")
        setMentionRange(null)
        setMentionPopoverPosition(null)
    }, [])

    const updateMentionState = useCallback(
        (valueBeforeCaret: string) => {
            const activeMention = getActiveMentionRange(valueBeforeCaret)

            if (!activeMention) {
                resetMentionState()
                return
            }

            setMentionQuery(activeMention.query)
            setMentionRange(activeMention.range)
            updateMentionPopoverPosition(activeMention.range)
        },
        [resetMentionState, updateMentionPopoverPosition]
    )

    useEffect(() => {
        if (!mentionRange) return

        const updatePosition = () => {
            updateMentionPopoverPosition(mentionRange)
        }

        window.addEventListener("resize", updatePosition)
        window.addEventListener("scroll", updatePosition, true)

        return () => {
            window.removeEventListener("resize", updatePosition)
            window.removeEventListener("scroll", updatePosition, true)
        }
    }, [mentionRange, updateMentionPopoverPosition])

    const insertMention = useCallback(
        (suggestion: MentionOption) => {
            const editor = editorRef.current
            if (!mentionRange || !editor) return

            const currentValue = editor.textContent || ""
            const beforeMention = currentValue.slice(0, mentionRange.start)
            const afterMention = currentValue.slice(mentionRange.end)
            const badgeType = suggestion.type === "doc" ? "document" : suggestion.type
            const badgePrefix = `${badgeType}:`
            const badgeText = `${badgePrefix} ${suggestion.label}`
            const badge = document.createElement("span")

            badge.className = [styles.badge, styles[suggestion.type], styles.inlineBadge].join(" ")
            badge.contentEditable = "false"
            badge.append(
                createBadgePrefix(suggestion, styles),
                Object.assign(document.createElement("span"), {
                    className: styles.name,
                    textContent: suggestion.label,
                })
            )

            const nextPrompt = `${beforeMention}${badgeText} ${afterMention}`

            replaceTextRangeWithBadge({
                badge,
                editor,
                end: mentionRange.end,
                start: mentionRange.start,
            })

            editor.focus()
            setPrompt(nextPrompt)

            const mentionExists = mentionsRef.current.some(
                (mention) =>
                    mention.type === suggestion.type &&
                    mention.slug === suggestion.slug &&
                    mention.parent === suggestion.parent &&
                    mention.collection === suggestion.collection &&
                    mention.id === suggestion.id
            )

            if (!mentionExists) {
                mentionsRef.current = [...mentionsRef.current, suggestion]
            }

            resetMentionState()
            resetDocumentSuggestions()
        },
        [editorRef, mentionRange, resetDocumentSuggestions, resetMentionState, setPrompt, styles]
    )

    const clearMentions = useCallback(() => {
        mentionsRef.current = []
        resetMentionState()
        resetDocumentSuggestions()
    }, [resetDocumentSuggestions, resetMentionState])

    return {
        clearMentions,
        getTextBeforeCaret,
        insertMention,
        mentionPopoverPosition,
        mentionQuery,
        mentionRange,
        mentionSuggestions,
        mentionsRef,
        updateMentionState,
    }
}

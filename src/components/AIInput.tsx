"use client"

import { useConfig } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { getResolvedAIModelConfig, type AIProvider, type AIModelConfig } from "../ai/providerOptions.js"
import { getSerializableLabel, isInternalCollection } from "../payload/shared.js"
import { AIActionProposalList, type AIActionProposal } from "./AIActionProposalList.js"
import styles from "./AIInput.module.css"
import { CollectionMentionPopover, type CollectionMentionOption } from "./CollectionMentionPopover.js"
import { ClaudeIcon, GoogleGeminiIcon, MistralAiIcon, OpenaiIcon, Send } from "./Icons.js"
import { RecentChangesList, type AppliedChange } from "./RecentChangesList.js"
import { useAISettings } from "./hooks/useAISettings.js"
import { useDocumentMentionSuggestions } from "./hooks/useDocumentMentionSuggestions.js"

type AIMention = {
    collection?: string
    id?: string
    label: string
    parent?: string
    slug: string
    type: "block" | "collection" | "doc" | "global"
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

type PayloadAiAdminCustom = {
    payloadAiPlugin?: {
        collectionSlugs?: string[]
        models?: AIModelConfig
    }
}

type AIChatStreamEvent =
    | {
          data: {
              delta?: string
          }
          event: "text"
      }
    | {
          data: {
              proposals?: AIActionProposal[]
          }
          event: "proposals"
      }
    | {
          data: {
              error?: string
          }
          event: "error"
      }
    | {
          data: Record<string, never>
          event: "done"
      }

const collectBlockOptions = ({ fields, parent }: { fields: FieldWithBlocks[]; parent: string }): CollectionMentionOption[] => {
    const options: CollectionMentionOption[] = []

    for (const field of fields) {
        if (field.type === "blocks" && field.blocks) {
            for (const block of field.blocks) {
                options.push({
                    label: getSerializableLabel(block.labels?.singular, block.slug),
                    parent,
                    slug: block.slug,
                    type: "block",
                })

                options.push(
                    ...collectBlockOptions({
                        fields: block.fields || [],
                        parent: `${parent}/${block.slug}`,
                    })
                )
            }
        }

        if (field.fields) {
            options.push(
                ...collectBlockOptions({
                    fields: field.fields,
                    parent,
                })
            )
        }
    }

    return options
}

const getProviderIcon = (provider: AIProvider | null) => {
    const iconProps = {
        "aria-hidden": true,
        className: styles.selectProviderIcon,
    }

    switch (provider) {
        case "claude":
            return <ClaudeIcon {...iconProps} />
        case "google":
            return <GoogleGeminiIcon {...iconProps} />
        case "mistral":
            return <MistralAiIcon {...iconProps} />
        case "openai":
            return <OpenaiIcon {...iconProps} />
        default:
            return null
    }
}

const parseSSEEvent = (chunk: string): AIChatStreamEvent | null => {
    const lines = chunk.split("\n")
    let eventName = ""
    const dataLines: string[] = []

    for (const line of lines) {
        if (line.startsWith("event:")) {
            eventName = line.slice(6).trim()
            continue
        }

        if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim())
        }
    }

    if (!eventName) return null

    try {
        const data = JSON.parse(dataLines.join("\n")) as AIChatStreamEvent["data"]

        if (eventName !== "text" && eventName !== "proposals" && eventName !== "error" && eventName !== "done") {
            return null
        }

        return {
            data,
            event: eventName,
        } as AIChatStreamEvent
    } catch {
        return null
    }
}

const sanitizeResponseText = (value: string) => value.replace(/\*\*/g, "")

export const AIInput = () => {
    const { config } = useConfig()
    const editorRef = useRef<HTMLDivElement>(null)
    const mentionPopoverRef = useRef<HTMLDivElement>(null)
    const [prompt, setPrompt] = useState("")
    const configuredModels = (config.admin?.custom as PayloadAiAdminCustom | undefined)?.payloadAiPlugin?.models
    const aiModelConfig = useMemo(() => getResolvedAIModelConfig(configuredModels), [configuredModels])
    const { selectedModel, setSelectedModel, settingsProvider } = useAISettings({
        adminUserSlug: config.admin?.user,
        apiRoute: config.routes.api,
        defaultModels: aiModelConfig.defaults,
    })
    const [mentionQuery, setMentionQuery] = useState("")
    const [mentionRange, setMentionRange] = useState<null | {
        end: number
        start: number
    }>(null)
    const [mentions, setMentions] = useState<AIMention[]>([])
    const [appliedProposalIndexes, setAppliedProposalIndexes] = useState<number[]>([])
    const [response, setResponse] = useState("")
    const [error, setError] = useState("")
    const [proposals, setProposals] = useState<AIActionProposal[]>([])
    const [appliedChanges, setAppliedChanges] = useState<AppliedChange[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isApplying, setIsApplying] = useState(false)
    const enabledCollectionSlugs = (config.admin?.custom as PayloadAiAdminCustom | undefined)?.payloadAiPlugin?.collectionSlugs
    const enabledCollectionSlugSet = useMemo(() => (enabledCollectionSlugs ? new Set(enabledCollectionSlugs) : null), [enabledCollectionSlugs])
    const isCollectionMentionEnabled = (slug: string) => !enabledCollectionSlugSet || enabledCollectionSlugSet.has(slug)
    const recentChangesEndpoint = useMemo(
        () =>
            formatAdminURL({
                apiRoute: config.routes.api,
                path: "/ai-recent-changes",
            }),
        [config.routes.api]
    )
    const loadRecentChanges = useCallback(async () => {
        const res = await fetch(recentChangesEndpoint)
        const result = (await res.json().catch(() => null)) as {
            changes?: AppliedChange[]
        } | null

        if (res.ok && result?.changes) {
            setAppliedChanges(result.changes)
        }
    }, [recentChangesEndpoint])

    useEffect(() => {
        void loadRecentChanges().catch(() => undefined)
    }, [loadRecentChanges])

    useEffect(() => {
        if (isLoading || error || proposals.length > 0 || !response) return

        const timeout = window.setTimeout(() => {
            setResponse("")
            clearInput()
        }, 5000)

        return () => window.clearTimeout(timeout)
    }, [error, isLoading, proposals.length, response])

    const collections: CollectionMentionOption[] = config.collections
        .filter((collection) => !isInternalCollection(collection.slug))
        .filter((collection) => isCollectionMentionEnabled(collection.slug))
        .map((collection) => ({
            label: getSerializableLabel(collection.labels?.singular, collection.slug),
            slug: collection.slug,
            type: "collection",
        }))
    const globals: CollectionMentionOption[] =
        config.globals?.map((global) => ({
            label: getSerializableLabel(global.label, global.slug),
            slug: global.slug,
            type: "global",
        })) || []
    const blocks: CollectionMentionOption[] = [
        ...config.collections
            .filter((collection) => isCollectionMentionEnabled(collection.slug))
            .flatMap((collection) =>
                collectBlockOptions({
                    fields: collection.fields as FieldWithBlocks[],
                    parent: collection.slug,
                })
            ),
        ...(config.globals?.flatMap((global) =>
            collectBlockOptions({
                fields: global.fields as FieldWithBlocks[],
                parent: global.slug,
            })
        ) || []),
    ]
    const mentionOptions = [...collections, ...globals, ...blocks]

    const normalizedMentionQuery = mentionQuery.toLowerCase()
    const filteredCollections = collections.filter((collection) => collection.slug.toLowerCase().includes(normalizedMentionQuery) || collection.label.toLowerCase().includes(normalizedMentionQuery))
    const filteredMentionOptions = mentionOptions.filter((option) => option.slug.toLowerCase().includes(normalizedMentionQuery))
    const documentSuggestionCollection = filteredCollections.length === 1 ? filteredCollections[0]?.slug : null
    const { documentSuggestions, resetDocumentSuggestions } = useDocumentMentionSuggestions({
        apiRoute: config.routes.api,
        documentSuggestionCollection,
        mentionQuery,
        mentionRange,
    })
    const mentionSuggestions = [...filteredMentionOptions, ...documentSuggestions]

    const getCaretOffset = (element: HTMLElement) => {
        const selection = window.getSelection()
        if (!selection || selection.rangeCount === 0) return 0

        const range = selection.getRangeAt(0)
        const clonedRange = range.cloneRange()

        clonedRange.selectNodeContents(element)
        clonedRange.setEnd(range.endContainer, range.endOffset)

        return clonedRange.toString().length
    }

    const getTextNodeAtOffset = (element: HTMLElement, offset: number) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let currentOffset = 0
        let node = walker.nextNode()

        while (node) {
            const nextOffset = currentOffset + (node.textContent?.length || 0)

            if (offset <= nextOffset) {
                return {
                    node,
                    offset: offset - currentOffset,
                }
            }

            currentOffset = nextOffset
            node = walker.nextNode()
        }

        const textNode = document.createTextNode("")
        element.append(textNode)

        return {
            node: textNode,
            offset: 0,
        }
    }

    const replaceTextRangeWithBadge = ({ badge, editor, end, start }: { badge: HTMLSpanElement; editor: HTMLElement; end: number; start: number }) => {
        const startPosition = getTextNodeAtOffset(editor, start)
        const endPosition = getTextNodeAtOffset(editor, end)
        const range = document.createRange()
        const trailingSpace = document.createTextNode(" ")

        range.setStart(startPosition.node, startPosition.offset)
        range.setEnd(endPosition.node, endPosition.offset)
        range.deleteContents()
        range.insertNode(trailingSpace)
        range.insertNode(badge)

        const selection = window.getSelection()
        const caretRange = document.createRange()

        caretRange.setStartAfter(trailingSpace)
        caretRange.collapse(true)
        selection?.removeAllRanges()
        selection?.addRange(caretRange)
    }

    const updateMentionState = (value: string, caretPosition: number) => {
        const valueBeforeCaret = value.slice(0, caretPosition)
        const match = /(?:^|\s)@([\w-]*)$/.exec(valueBeforeCaret)

        if (!match || typeof match.index !== "number") {
            setMentionQuery("")
            setMentionRange(null)
            return
        }

        const atIndex = valueBeforeCaret.lastIndexOf("@")

        setMentionQuery(match[1] || "")
        setMentionRange({ end: caretPosition, start: atIndex })
    }

    const clearInput = () => {
        setPrompt("")
        setMentions([])
        if (editorRef.current) editorRef.current.textContent = ""
    }

    const getProposalViewURL = (proposal: AIActionProposal) => {
        const adminRoute = config.routes.admin || "/admin"

        if (proposal.action === "updateGlobal" && proposal.slug) {
            return `${adminRoute}/globals/${proposal.slug}`
        }

        if (proposal.collection && proposal.id) {
            return `${adminRoute}/collections/${proposal.collection}/${proposal.id}`
        }

        return null
    }

    const insertMention = (suggestion: CollectionMentionOption) => {
        const editor = editorRef.current
        if (!mentionRange || !editor) return

        const beforeMention = prompt.slice(0, mentionRange.start)
        const afterMention = prompt.slice(mentionRange.end)
        const badgeType = suggestion.type === "doc" ? "document" : suggestion.type
        const badgePrefix = `${badgeType}:`
        const badgeText = `${badgePrefix} ${suggestion.label}`
        const promptText = suggestion.type === "doc" ? `${badgeText} (${suggestion.collection}/${suggestion.id})` : badgeText
        const badge = document.createElement("span")

        badge.className = [styles.badge, styles[suggestion.type], styles.inlineBadge].join(" ")
        badge.contentEditable = "false"
        badge.append(
            Object.assign(document.createElement("span"), {
                className: styles.prefix,
                textContent: `${badgePrefix} `,
            }),
            Object.assign(document.createElement("span"), {
                className: styles.name,
                textContent: suggestion.label,
            })
        )

        replaceTextRangeWithBadge({
            badge,
            editor,
            end: mentionRange.end,
            start: mentionRange.start,
        })
        editor.focus()

        setPrompt(`${beforeMention}${promptText} ${afterMention}`)
        setMentions((currentMentions) => {
            const mentionExists = currentMentions.some(
                (mention) =>
                    mention.type === suggestion.type &&
                    mention.slug === suggestion.slug &&
                    mention.parent === suggestion.parent &&
                    mention.collection === suggestion.collection &&
                    mention.id === suggestion.id
            )

            if (mentionExists) return currentMentions

            return [...currentMentions, suggestion]
        })
        setMentionQuery("")
        setMentionRange(null)
        resetDocumentSuggestions()
    }

    const handleSubmit = async () => {
        const trimmedPrompt = prompt.trim()
        if (!trimmedPrompt) return

        setIsLoading(true)
        setAppliedProposalIndexes([])
        setError("")
        setProposals([])
        setResponse("")

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute: config.routes.api,
                    path: "/ai-chat",
                }),
                {
                    body: JSON.stringify({
                        mentions,
                        model: selectedModel,
                        prompt: trimmedPrompt,
                    }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                }
            )

            if (!res.ok) {
                const result = (await res.json().catch(() => null)) as {
                    error?: string
                } | null

                throw new Error(result?.error || "AI request failed")
            }

            if (!res.body) {
                throw new Error("AI response stream is unavailable")
            }

            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ""

            while (true) {
                const { done, value } = await reader.read()

                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const chunks = buffer.split("\n\n")
                buffer = chunks.pop() || ""

                for (const chunk of chunks) {
                    const event = parseSSEEvent(chunk)
                    if (!event) continue

                    if (event.event === "text") {
                        if (event.data.delta) {
                            setResponse((current) => current + sanitizeResponseText(event.data.delta || ""))
                        }
                        continue
                    }

                    if (event.event === "proposals") {
                        setProposals(event.data.proposals || [])
                        continue
                    }

                    if (event.event === "error") {
                        throw new Error(event.data.error || "AI request failed")
                    }
                }
            }

            const finalEvent = buffer.trim() ? parseSSEEvent(buffer.trim()) : null
            if (finalEvent?.event === "proposals") {
                setProposals(finalEvent.data.proposals || [])
            }
            if (finalEvent?.event === "error") {
                throw new Error(finalEvent.data.error || "AI request failed")
            }
        } catch (err) {
            setProposals([])
            setResponse("")
            setError(err instanceof Error ? err.message : "AI request failed")
        } finally {
            setIsLoading(false)
        }
    }

    const handleApplyProposal = async (proposal: AIActionProposal) => {
        setIsApplying(true)
        setError("")

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute: config.routes.api,
                    path: "/ai-apply-action",
                }),
                {
                    body: JSON.stringify({ proposal }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                }
            )

            const result = (await res.json()) as {
                change?: AppliedChange | null
                doc?: {
                    id?: unknown
                }
                error?: string
            }
            if (!res.ok) {
                setProposals([])
                setResponse("")
                throw new Error(result.error || "Could not apply proposal")
            }

            setAppliedProposalIndexes([])
            setError("")
            setProposals([])
            setResponse("")
            if (result.change) {
                setAppliedChanges((current) => [result.change as AppliedChange, ...current].slice(0, 12))
            }
            void loadRecentChanges().catch(() => undefined)
            clearInput()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not apply proposal")
        } finally {
            setIsApplying(false)
        }
    }

    return (
        <div className={styles.chatLayout}>
            <div className={styles.chat}>
                <div className={styles.chatHeader}>
                    <div>
                        <h2 className={styles.chatTitle}>AI Assistant</h2>
                        <p className={styles.chatDescription}>Ask AI to draft, improve, or analyze content.</p>
                    </div>
                </div>
                <div className={styles.chatInputRow}>
                    <div className={styles.chatInputSurface}>
                        <div
                            className={styles.chatInput}
                            contentEditable
                            data-placeholder="Ask AI..."
                            onInput={(event) => {
                                const value = event.currentTarget.innerText

                                setPrompt(value)
                                if (!value.trim()) {
                                    setMentions([])
                                }
                                updateMentionState(value, getCaretOffset(event.currentTarget))
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown" && mentionRange && mentionSuggestions.length > 0) {
                                    const firstOption = mentionPopoverRef.current?.querySelector<HTMLButtonElement>("button")
                                    if (firstOption) {
                                        event.preventDefault()
                                        firstOption.focus()
                                        return
                                    }
                                }
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault()
                                    void handleSubmit()
                                }
                            }}
                            ref={editorRef}
                            role="textbox"
                            suppressContentEditableWarning
                        />
                    </div>
                    {mentionRange ? <CollectionMentionPopover containerRef={mentionPopoverRef} onSelect={insertMention} suggestions={mentionSuggestions} /> : null}
                </div>
                <div className={styles.chatActionsRow}>
                    <div className={styles.settings}>
                        <label className={styles.setting}>
                            <span className={styles.settingLabel}>Model</span>
                            <div className={styles.selectWrapper}>
                                {getProviderIcon(settingsProvider)}
                                <select className={styles.select} disabled={!settingsProvider} onChange={(event) => setSelectedModel(event.target.value)} value={selectedModel}>
                                    {!settingsProvider && <option value="">Select provider in account settings</option>}
                                    {settingsProvider &&
                                        aiModelConfig.providers[settingsProvider].map((model) => (
                                            <option key={model.value} value={model.value}>
                                                {model.label}
                                            </option>
                                        ))}
                                </select>
                            </div>
                        </label>
                    </div>
                    <button className={styles.chatButton} disabled={!prompt.trim() || !settingsProvider || !selectedModel || isLoading} onClick={() => void handleSubmit()} type="button">
                        <Send width={14} height={14} />
                        {isLoading ? "Sending..." : "Send"}
                    </button>
                </div>
                <AIActionProposalList
                    apiRoute={config.routes.api}
                    appliedProposalIndexes={appliedProposalIndexes}
                    description={response}
                    error={error}
                    getViewURL={getProposalViewURL}
                    isApplying={isApplying}
                    onDismiss={() => {
                        setAppliedProposalIndexes([])
                        setError("")
                        setProposals([])
                        setResponse("")
                        clearInput()
                    }}
                    onDismissError={() => {
                        setError("")
                    }}
                    onApply={(proposal, _index) => void handleApplyProposal(proposal)}
                    proposals={proposals}
                />
            </div>
            <RecentChangesList changes={appliedChanges} />
        </div>
    )
}

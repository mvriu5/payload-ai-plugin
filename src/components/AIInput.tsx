"use client"

import { useConfig } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react"

import { getResolvedAIModelConfig, type AIProvider, type AIModelConfig } from "../ai/providerOptions.js"
import { getSerializableLabel, isInternalCollection } from "../payload/shared.js"
import { ActionToast, type ActionProposal } from "./ActionToast.js"
import styles from "./AIInput.module.css"
import { MentionPopover, type MentionOption } from "./MentionPopover.js"
import { ClaudeIcon, GoogleGeminiIcon, MistralAiIcon, OpenaiIcon, OpenrouterIcon, Send } from "./Icons.js"
import { RecentChangesList, type AppliedChange } from "./AuditLogList.js"
import { useAISettings } from "./hooks/useAISettings.js"
import { useDocumentMentionSuggestions } from "./hooks/useDocumentMentionSuggestions.js"

type Mention = {
    collection?: string
    id?: string
    isDefault?: boolean
    label: string
    parent?: string
    slug: string
    type: "block" | "collection" | "doc" | "global" | "locale"
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

type PayloadAIAdminCustom = {
    payloadAiPlugin?: {
        collectionSlugs?: string[]
        models?: AIModelConfig
    }
}

type LocalizationConfig = {
    defaultLocale?: string
    locales?: Array<
        | string
        | {
              code?: string
              label?: unknown
          }
    >
}

type ChatStreamEvent =
    | {
          data: {
              activeLocale?: string
              model?: string
              proposalCount?: number
              provider?: string
              reason?: "model_did_not_call_tool" | "proposal_created" | "tool_validation_failed" | "write_intent_without_tool_call"
              selectedLocales?: string[]
              toolFailures?: Array<{
                  collection?: string
                  details?: Record<string, unknown>
                  message: string
                  slug?: string
                  tool: string
              }>
              usage?: {
                  inputTokens?: number
                  outputTokens?: number
                  totalTokens?: number
              } | null
          }
          event: "debug"
      }
    | {
          data: {
              delta?: string
          }
          event: "text"
      }
    | {
          data: {
              proposals?: ActionProposal[]
              usage?: {
                  inputTokens?: number
                  outputTokens?: number
                  totalTokens?: number
              } | null
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

type ChatDebugInfo = Extract<ChatStreamEvent, { event: "debug" }>["data"]

type ApplyDebugInfo = {
    action?: string
    collection?: string
    details?: Record<string, unknown>
    id?: string
    phase: "apply_validation" | "authorization" | "payload_operation"
    reason: string
    slug?: string
}

const collectBlockOptions = ({ fields, parent }: { fields: FieldWithBlocks[]; parent: string }): MentionOption[] => {
    const options: MentionOption[] = []

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
        case "openrouter":
            return <OpenrouterIcon {...iconProps} />
        default:
            return null
    }
}

const parseSSEEvent = (chunk: string): ChatStreamEvent | null => {
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
        const data = JSON.parse(dataLines.join("\n")) as ChatStreamEvent["data"]

        if (eventName !== "text" && eventName !== "proposals" && eventName !== "error" && eventName !== "done" && eventName !== "debug") {
            return null
        }

        return {
            data,
            event: eventName,
        } as ChatStreamEvent
    } catch {
        return null
    }
}

const sanitizeResponseText = (value: string) => value.replace(/\*\*/g, "")

const getDebugReasonLabel = (reason?: ChatDebugInfo["reason"]) => {
    switch (reason) {
        case "model_did_not_call_tool":
            return "Model did not create a proposal tool call."
        case "proposal_created":
            return "Proposal created."
        case "tool_validation_failed":
            return "Tool validation failed before a proposal could be created."
        case "write_intent_without_tool_call":
            return "The selected model did not produce the required proposal tool call for this content change."
        default:
            return "Unknown"
    }
}

const getApplyDebugReasonLabel = (reason?: ApplyDebugInfo["reason"]) => {
    switch (reason) {
        case "unauthorized":
            return "Request was not authorized."
        case "missing_proposal":
            return "No proposal was submitted to apply."
        case "invalid_signature":
            return "Proposal signature was invalid or expired."
        case "invalid_proposal_shape":
            return "Proposal shape was invalid."
        case "sensitive_data_in_data":
        case "sensitive_data_in_localized_data":
            return "Proposal contained sensitive data."
        case "unknown_global":
            return "Target global was not found."
        case "unknown_or_disallowed_collection":
            return "Target collection is unknown or not allowed."
        case "invalid_collection_write_shape":
            return "Proposal data does not match the target collection schema."
        case "invalid_global_write_shape":
            return "Proposal data does not match the target global schema."
        case "localized_create_without_locales":
            return "Localized create proposal had no locale entries."
        case "missing_auth_password":
            return "Auth create proposal was missing a password."
        case "missing_auth_email":
            return "Auth create proposal was missing an email."
        case "payload_operation_failed":
            return "Payload rejected the write operation."
        default:
            return "Unknown"
    }
}

const getChatDebugMessage = (debugInfo: ChatDebugInfo) => {
    if (debugInfo.toolFailures?.length) {
        return debugInfo.toolFailures[0]?.message || getDebugReasonLabel(debugInfo.reason)
    }

    return getDebugReasonLabel(debugInfo.reason)
}

const isMentionBoundary = (character: string | undefined) => {
    return character === undefined || /\s/.test(character)
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

const svgNamespace = "http://www.w3.org/2000/svg"
const auditLogCollectionSlug = "payload-ai-auditlog"
const responseOnlyToastCooldownMs = 10000

const appendSvgPath = (svg: SVGSVGElement, d: string) => {
    const path = document.createElementNS(svgNamespace, "path")

    path.setAttribute("d", d)
    svg.append(path)
}

const createBadgeIcon = (type: Mention["type"]) => {
    if (type === "locale") return null

    const svg = document.createElementNS(svgNamespace, "svg")

    svg.setAttribute("aria-hidden", "true")
    svg.setAttribute("class", styles.badgeIcon)
    svg.setAttribute("fill", "none")
    svg.setAttribute("stroke", "currentColor")
    svg.setAttribute("stroke-linecap", "round")
    svg.setAttribute("stroke-linejoin", "round")
    svg.setAttribute("stroke-width", "2")
    svg.setAttribute("viewBox", "0 0 24 24")

    if (type === "collection") {
        appendSvgPath(svg, "M5 4h4l3 3h7a2 2 0 0 1 2 2v8a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2")
    }

    if (type === "doc") {
        appendSvgPath(svg, "M14 3v4a1 1 0 0 0 1 1h4")
        appendSvgPath(svg, "M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2")
    }

    if (type === "global") {
        appendSvgPath(svg, "M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0")
        appendSvgPath(svg, "M3.6 9h16.8")
        appendSvgPath(svg, "M3.6 15h16.8")
        appendSvgPath(svg, "M11.5 3a17 17 0 0 0 0 18")
        appendSvgPath(svg, "M12.5 3a17 17 0 0 1 0 18")
    }

    if (type === "block") {
        appendSvgPath(svg, "M14 4a1 1 0 0 1 1 -1h5a1 1 0 0 1 1 1v5a1 1 0 0 1 -1 1h-5a1 1 0 0 1 -1 -1l0 -5")
        appendSvgPath(svg, "M3 14h12a2 2 0 0 1 2 2v3a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2h3a2 2 0 0 1 2 2v12")
    }

    return svg
}

const createBadgePrefix = (suggestion: MentionOption) => {
    const prefix = document.createElement("span")
    const icon = createBadgeIcon(suggestion.type)

    prefix.className = styles.prefix

    if (icon) {
        prefix.append(icon)
    }

    if (suggestion.type === "doc") {
        prefix.append(document.createTextNode(`${suggestion.collection || "document"}:`))
    } else if (suggestion.type === "locale") {
        prefix.textContent = "locale:"
    }

    return prefix
}

const getTextBeforeCaret = (element: HTMLElement) => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) return ""

    const range = selection.getRangeAt(0)
    const clonedRange = range.cloneRange()

    clonedRange.selectNodeContents(element)
    clonedRange.setEnd(range.endContainer, range.endOffset)

    return clonedRange.toString()
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

const AIInput = () => {
    const { config } = useConfig()
    const editorRef = useRef<HTMLDivElement>(null)
    const [prompt, setPrompt] = useState("")
    const configuredModels = (config.admin?.custom as PayloadAIAdminCustom | undefined)?.payloadAiPlugin?.models
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
    const [mentionPopoverPosition, setMentionPopoverPosition] = useState<null | {
        left: number
        top: number
    }>(null)
    const mentionsRef = useRef<Mention[]>([])
    const [appliedProposalIndexes, setAppliedProposalIndexes] = useState<number[]>([])
    const [response, setResponse] = useState("")
    const [tokenUsage, setTokenUsage] = useState<null | {
        inputTokens?: number
        outputTokens?: number
        totalTokens?: number
    }>(null)
    const [applyDebugInfo, setApplyDebugInfo] = useState<ApplyDebugInfo | null>(null)
    const [error, setError] = useState("")
    const [proposals, setProposals] = useState<ActionProposal[]>([])
    const [appliedChanges, setAppliedChanges] = useState<AppliedChange[]>([])
    const [isLoading, setIsLoading] = useState(false)
    const [isApplying, setIsApplying] = useState(false)
    const enabledCollectionSlugs = (config.admin?.custom as PayloadAIAdminCustom | undefined)?.payloadAiPlugin?.collectionSlugs
    const enabledCollectionSlugSet = useMemo(() => (enabledCollectionSlugs ? new Set(enabledCollectionSlugs) : null), [enabledCollectionSlugs])
    const isCollectionMentionEnabled = (slug: string) => !enabledCollectionSlugSet || enabledCollectionSlugSet.has(slug)
    const recentChangesEndpoint = useMemo(
        () =>
            formatAdminURL({
                apiRoute: config.routes.api,
                path: "/ai-audit-log",
            }),
        [config.routes.api]
    )
    const allChangesURL = `${config.routes.admin || "/admin"}/collections/${auditLogCollectionSlug}`
    const loadRecentChanges = useCallback(async () => {
        const res = await fetch(recentChangesEndpoint)
        const result = (await res.json().catch(() => null)) as {
            changes?: AppliedChange[]
        } | null

        if (res.ok && result?.changes) {
            setAppliedChanges(result.changes.slice(0, 10))
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
        }, responseOnlyToastCooldownMs)

        return () => window.clearTimeout(timeout)
    }, [error, isLoading, proposals.length, response])

    const collections: MentionOption[] = config.collections.flatMap((collection) => {
        if (isInternalCollection(collection.slug) || !isCollectionMentionEnabled(collection.slug)) return []

        return [
            {
                label: getSerializableLabel(collection.labels?.singular, collection.slug),
                slug: collection.slug,
                type: "collection" as const,
            },
        ]
    })
    const globals: MentionOption[] =
        config.globals?.map((global) => ({
            label: getSerializableLabel(global.label, global.slug),
            slug: global.slug,
            type: "global",
        })) || []
    const localizationConfig = (config as typeof config & { localization?: LocalizationConfig }).localization
    const localesConfig = localizationConfig?.locales ?? []
    const locales: MentionOption[] = localesConfig.flatMap((locale) => {
        if (typeof locale === "string") {
            return [
                {
                    isDefault: locale === localizationConfig?.defaultLocale,
                    label: locale,
                    slug: locale,
                    type: "locale" as const,
                },
            ]
        }

        if (!locale || typeof locale !== "object") return []

        const slug = typeof locale.code === "string" ? locale.code : typeof locale.label === "string" ? locale.label : null

        if (!slug) return []

        return [
            {
                isDefault: slug === localizationConfig?.defaultLocale,
                label: getSerializableLabel(locale.label, slug),
                slug,
                type: "locale" as const,
            },
        ]
    })
    const blocks: MentionOption[] = [
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
    ]
    const mentionOptions = [...collections, ...globals, ...blocks, ...locales]

    const normalizedMentionQuery = mentionQuery.toLowerCase()
    const filteredCollections = collections.filter(
        (collection) => collection.slug.toLowerCase().includes(normalizedMentionQuery) || collection.label.toLowerCase().includes(normalizedMentionQuery)
    )
    const filteredMentionOptions = mentionOptions.filter(
        (option) => option.slug.toLowerCase().includes(normalizedMentionQuery) || option.label.toLowerCase().includes(normalizedMentionQuery)
    )
    const documentSuggestionCollection = filteredCollections.length === 1 ? filteredCollections[0]?.slug : null
    const { documentSuggestions, resetDocumentSuggestions } = useDocumentMentionSuggestions({
        apiRoute: config.routes.api,
        documentSuggestionCollection,
        mentionQuery,
        mentionRange,
    })
    const mentionSuggestions = [...filteredMentionOptions, ...documentSuggestions]
    const shouldShowApplyDebugInfo = Boolean(applyDebugInfo) && Boolean(error)
    const actionToastDescription = response

    const updateMentionPopoverPosition = useCallback((range: { end: number; start: number } | null) => {
        const editor = editorRef.current

        if (!editor || !range) {
            setMentionPopoverPosition(null)
            return
        }

        const startPosition = getTextNodeAtOffset(editor, range.start)
        const anchorRange = document.createRange()

        anchorRange.setStart(startPosition.node, startPosition.offset)
        anchorRange.setEnd(startPosition.node, startPosition.offset)

        const editorRect = editor.getBoundingClientRect()
        const anchorRect = anchorRange.getBoundingClientRect()
        const fallbackLeft = Math.max(0, anchorRect.left - editorRect.left + 12)
        const fallbackTop = Math.max(0, anchorRect.bottom - editorRect.top + 20)
        const popoverWidth = editorRef.current?.offsetWidth || 260
        const maxLeft = Math.max(0, editor.clientWidth - popoverWidth)

        setMentionPopoverPosition({
            left: Math.min(fallbackLeft, maxLeft),
            top: fallbackTop,
        })
    }, [])

    const updateMentionState = (valueBeforeCaret: string) => {
        const activeMention = getActiveMentionRange(valueBeforeCaret)

        if (!activeMention) {
            setMentionQuery("")
            setMentionRange(null)
            setMentionPopoverPosition(null)
            return
        }

        setMentionQuery(activeMention.query)
        setMentionRange(activeMention.range)
        updateMentionPopoverPosition(activeMention.range)
    }

    const updateMentionPopoverPositionEvent = useEffectEvent((range: { end: number; start: number }) => {
        updateMentionPopoverPosition(range)
    })

    useEffect(() => {
        if (!mentionRange) return

        const updatePosition = () => updateMentionPopoverPositionEvent(mentionRange)

        window.addEventListener("resize", updatePosition)
        window.addEventListener("scroll", updatePosition, true)

        return () => {
            window.removeEventListener("resize", updatePosition)
            window.removeEventListener("scroll", updatePosition, true)
        }
    }, [mentionRange])

    const clearInput = () => {
        setPrompt("")
        mentionsRef.current = []
        if (editorRef.current) editorRef.current.textContent = ""
    }

    const getProposalViewURL = (proposal: ActionProposal) => {
        const adminRoute = config.routes.admin || "/admin"

        if (proposal.action === "updateGlobal" && proposal.slug) {
            return `${adminRoute}/globals/${proposal.slug}`
        }

        if (proposal.collection && proposal.id) {
            return `${adminRoute}/collections/${proposal.collection}/${proposal.id}`
        }

        return null
    }

    const insertMention = (suggestion: MentionOption) => {
        const editor = editorRef.current
        if (!mentionRange || !editor) return

        const currentValue = editor.innerText
        const beforeMention = currentValue.slice(0, mentionRange.start)
        const afterMention = currentValue.slice(mentionRange.end)
        const badgeType = suggestion.type === "doc" ? "document" : suggestion.type
        const badgePrefix = `${badgeType}:`
        const badgeText = `${badgePrefix} ${suggestion.label}`
        const badge = document.createElement("span")

        badge.className = [styles.badge, styles[suggestion.type], styles.inlineBadge].join(" ")
        badge.contentEditable = "false"
        badge.append(
            createBadgePrefix(suggestion),
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

        setPrompt(`${beforeMention}${badgeText} ${afterMention}`)
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
        setMentionQuery("")
        setMentionRange(null)
        setMentionPopoverPosition(null)
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
        setTokenUsage(null)
        setApplyDebugInfo(null)

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute: config.routes.api,
                    path: "/ai-chat",
                }),
                {
                    body: JSON.stringify({
                        mentions: mentionsRef.current,
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
            let finalDebugInfo: ChatDebugInfo | null = null
            let receivedProposals: ActionProposal[] = []
            let receivedText = ""
            let receivedVisibleText = ""

            const processStreamChunks = async (): Promise<void> => {
                const { done, value } = await reader.read()

                if (done) return

                buffer += decoder.decode(value, { stream: true })
                const chunks = buffer.split("\n\n")
                buffer = chunks.pop() || ""

                for (const chunk of chunks) {
                    const event = parseSSEEvent(chunk)
                    if (!event) continue

                    if (event.event === "text") {
                        if (event.data.delta) {
                            const nextDelta = sanitizeResponseText(event.data.delta || "")
                            receivedText += nextDelta
                            receivedVisibleText += nextDelta.replace(/\s+/g, "")
                            setResponse((current) => current + nextDelta)
                        }
                        continue
                    }

                    if (event.event === "proposals") {
                        receivedProposals = event.data.proposals || []
                        setProposals(receivedProposals)
                        setTokenUsage(event.data.usage || null)
                        continue
                    }

                    if (event.event === "debug") {
                        finalDebugInfo = event.data

                        if ((event.data.proposalCount || 0) === 0 && !receivedVisibleText) {
                            // Show specific tool validation message if present, otherwise a generic no‑action message
                            if (event.data.reason === "tool_validation_failed") {
                                const msg = getChatDebugMessage(event.data)
                                setResponse(msg)
                                // Auto‑clear after the standard toast timeout
                                window.setTimeout(() => setResponse(""), responseOnlyToastCooldownMs)
                            } else {
                                setResponse("No action needed")
                            }
                        }
                        continue
                    }

                    if (event.event === "error") {
                        throw new Error(event.data.error || "AI request failed")
                    }
                }

                await processStreamChunks()
            }

            await processStreamChunks()

            const finalEvent = buffer.trim() ? parseSSEEvent(buffer.trim()) : null
            if (finalEvent?.event === "proposals") {
                receivedProposals = finalEvent.data.proposals || []
                setProposals(receivedProposals)
                setTokenUsage(finalEvent.data.usage || null)
            }
            if (finalEvent?.event === "debug") {
                finalDebugInfo = finalEvent.data
                if ((finalEvent.data.proposalCount || 0) === 0 && !receivedVisibleText) {
                    // Same logic as above for the final event
                    if (finalEvent.data.reason === "tool_validation_failed") {
                        setResponse(getChatDebugMessage(finalEvent.data))
                    } else {
                        setResponse("No action needed")
                    }
                }
            }
            if (finalEvent?.event === "error") {
                throw new Error(finalEvent.data.error || "AI request failed")
            }

            if (receivedProposals.length === 0) {
                if (finalDebugInfo) {
                    const debugMessage = getChatDebugMessage(finalDebugInfo)
                    const isMeaningfulVisibleText = receivedVisibleText.length >= 12
                    const trimmedReceivedText = receivedText.trim()

                    if (!isMeaningfulVisibleText || trimmedReceivedText.length < 12) {
                        setResponse(debugMessage)
                    } else {
                        setResponse((current) => current.trim() || debugMessage)
                    }
                } else {
                    // Fallback when no debug info is provided (e.g., tool validation failures without a debug event)
                    setResponse("No action needed")
                }
                clearInput()
            }
        } catch (err) {
            setProposals([])
            setResponse("")
            setTokenUsage(null)
            setApplyDebugInfo(null)
            setError(err instanceof Error ? err.message : "AI request failed")
        } finally {
            setIsLoading(false)
        }
    }

    const handleApplyProposal = async (proposal: ActionProposal) => {
        setIsApplying(true)
        setError("")

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute: config.routes.api,
                    path: "/ai-apply-action",
                }),
                {
                    body: JSON.stringify({
                        aiResponse: response,
                        prompt,
                        proposal,
                        tokenUsage,
                    }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                }
            )

            const result = (await res.json()) as {
                change?: AppliedChange | null
                debug?: ApplyDebugInfo
                doc?: {
                    id?: unknown
                }
                error?: string
            }
            if (!res.ok) {
                setProposals([])
                setResponse("")
                setApplyDebugInfo(result.debug || null)
                throw new Error(result.error || "Could not apply proposal")
            }

            setAppliedProposalIndexes([])
            setError("")
            setProposals([])
            setResponse("")
            setTokenUsage(null)
            setApplyDebugInfo(null)
            if (result.change) {
                setAppliedChanges((current) => [result.change as AppliedChange, ...current].slice(0, 10))
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
                        <label htmlFor="ai-input" className={styles.inputLabel}>
                            Ask AI
                        </label>
                        <div
                            id="ai-input"
                            className={styles.chatInput}
                            role="textbox"
                            aria-label="AIInput"
                            contentEditable
                            data-placeholder="Ask AI..."
                            onInput={(event) => {
                                const value = (event.target as HTMLElement).innerText
                                setPrompt(value)
                                if (!value.trim()) {
                                    mentionsRef.current = []
                                }
                                // Update mention state using the element itself
                                updateMentionState(getTextBeforeCaret(event.target as HTMLElement))
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown" && mentionRange && mentionSuggestions.length > 0) {
                                    const firstOption = editorRef.current?.querySelector<HTMLButtonElement>("button")
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
                        />
                    </div>
                    {mentionRange && (
                        <MentionPopover
                            containerRef={editorRef}
                            onSelect={insertMention}
                            style={
                                mentionPopoverPosition
                                    ? {
                                          left: `${mentionPopoverPosition.left}px`,
                                          top: `${mentionPopoverPosition.top}px`,
                                      }
                                    : undefined
                            }
                            suggestions={mentionSuggestions}
                        />
                    )}
                </div>
                <div className={styles.chatActionsRow}>
                    <div className={styles.settings}>
                        <label className={styles.setting}>
                            <span className={styles.settingLabel}>Model</span>
                            <div className={styles.selectWrapper}>
                                {getProviderIcon(settingsProvider)}
                                <select
                                    className={styles.select}
                                    disabled={!settingsProvider}
                                    onChange={(event) => setSelectedModel(event.target.value)}
                                    value={selectedModel}
                                >
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
                    <button
                        className={styles.chatButton}
                        disabled={
                            !prompt.trim() ||
                            !settingsProvider ||
                            !selectedModel ||
                            isLoading ||
                            Boolean(error) ||
                            Boolean(actionToastDescription) ||
                            proposals.length > 0
                        }
                        onClick={() => void handleSubmit()}
                        type="button"
                    >
                        <Send width={14} height={14} />
                        {isLoading ? "Sending..." : "Send"}
                    </button>
                </div>
                <ActionToast
                    apiRoute={config.routes.api}
                    appliedProposalIndexes={appliedProposalIndexes}
                    description={actionToastDescription}
                    error={error}
                    getViewURL={getProposalViewURL}
                    isApplying={isApplying}
                    onDismiss={() => {
                        setAppliedProposalIndexes([])
                        setError("")
                        setProposals([])
                        setResponse("")
                        setTokenUsage(null)
                        setApplyDebugInfo(null)
                        clearInput()
                    }}
                    onDismissError={() => {
                        setError("")
                    }}
                    onApply={(proposal, _index) => void handleApplyProposal(proposal)}
                    proposals={proposals}
                    prompt={prompt}
                    tokenUsage={tokenUsage}
                />

                {shouldShowApplyDebugInfo && applyDebugInfo && (
                    <div className={styles.debugInfo}>
                        <strong>Apply debug</strong>
                        <br />
                        Reason: {getApplyDebugReasonLabel(applyDebugInfo.reason)}
                        <br />
                        Phase: {applyDebugInfo.phase}
                        <br />
                        Target: {applyDebugInfo.collection || applyDebugInfo.slug || "unknown"}
                        {applyDebugInfo.id ? (
                            <>
                                <br />
                                ID: {applyDebugInfo.id}
                            </>
                        ) : null}
                        {applyDebugInfo.details ? (
                            <>
                                <br />
                                Details:
                                <pre className={styles.debugDetails}>{JSON.stringify(applyDebugInfo.details, null, 2)}</pre>
                            </>
                        ) : null}
                    </div>
                )}
            </div>
            <RecentChangesList allChangesURL={allChangesURL} changes={appliedChanges} />
        </div>
    )
}

export default AIInput

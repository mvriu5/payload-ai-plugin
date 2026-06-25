import { formatAdminURL } from "payload/shared"
import { RefObject, useCallback, useState } from "react"
import type { ActionProposal } from "../action-toast/ActionToast.js"
import type { Mention } from "./useMentions.js"

export type TokenUsage = {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
}

export type MediaAttachment = {
    collection: string
    filename: string
    filesize: number
    id: string
    mimeType: string
    type: "media"
    url?: string
}

type ChatStreamEvent =
    | {
          data: {
              proposalCount?: number
              reason?: "model_did_not_call_tool" | "proposal_created" | "tool_validation_failed" | "write_intent_without_tool_call"
              toolFailures?: Array<{ message: string }>
          }
          event: "debug"
      }
    | {
          data: { delta?: string }
          event: "text"
      }
    | {
          data: {
              proposals?: ActionProposal[]
              usage?: TokenUsage | null
          }
          event: "proposals"
      }
    | {
          data: { error?: string }
          event: "error"
      }
    | {
          data: Record<string, never>
          event: "done"
      }

type ChatDebugInfo = Extract<ChatStreamEvent, { event: "debug" }>["data"]

const responseOnlyToastCooldownMs = 10000

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

        if (!["text", "proposals", "error", "done", "debug"].includes(eventName)) {
            return null
        }

        return { data, event: eventName } as ChatStreamEvent
    } catch {
        return null
    }
}

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

const getChatDebugMessage = (debugInfo: ChatDebugInfo) => {
    if (debugInfo.toolFailures?.length) {
        return debugInfo.toolFailures[0]?.message || getDebugReasonLabel(debugInfo.reason)
    }

    return getDebugReasonLabel(debugInfo.reason)
}

export const useAIChatStream = ({
    apiRoute,
    clearInput,
    mentionsRef,
    prompt,
    selectedModel,
}: {
    apiRoute: string
    clearInput: () => void
    mentionsRef: RefObject<Mention[]>
    prompt: string
    selectedModel: string
}) => {
    const [response, setResponse] = useState("")
    const [tokenUsage, setTokenUsage] = useState<TokenUsage | null>(null)
    const [error, setError] = useState("")
    const [proposals, setProposals] = useState<ActionProposal[]>([])
    const [isLoading, setIsLoading] = useState(false)

    const resetChatState = useCallback(() => {
        setError("")
        setProposals([])
        setResponse("")
        setTokenUsage(null)
    }, [])

    const dismissChat = useCallback(() => {
        resetChatState()
        clearInput()
    }, [clearInput, resetChatState])

    const submit = useCallback(async ({ attachments = [] }: { attachments?: MediaAttachment[] } = {}) => {
        const trimmedPrompt = prompt.trim()
        if (!trimmedPrompt) return

        setIsLoading(true)
        resetChatState()

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute,
                    path: "/ai-chat",
                }),
                {
                    body: JSON.stringify({
                        ...(attachments.length > 0 ? { attachments } : {}),
                        mentions: mentionsRef.current,
                        model: selectedModel,
                        prompt: trimmedPrompt,
                    }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                }
            )

            if (!res.ok) {
                const result = (await res.json().catch(() => null)) as { error?: string } | null
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

            const handleEvent = (event: ChatStreamEvent) => {
                if (event.event === "text") {
                    if (!event.data.delta) return

                    const nextDelta = event.data.delta.replace(/\*\*/g, "")
                    receivedText += nextDelta
                    receivedVisibleText += nextDelta.replace(/\s+/g, "")
                    setResponse((current) => current + nextDelta)
                    return
                }

                if (event.event === "proposals") {
                    const incoming = event.data.proposals || []

                    const grouped = new Map<string, ActionProposal>()

                    ;[...receivedProposals, ...incoming].forEach((p) => {
                        const key = [p.action, p.collection ?? "", p.slug ?? "", p.id ?? "", p.label].join("|")

                        if (!grouped.has(key)) {
                            grouped.set(key, p)
                        }
                    })

                    receivedProposals = Array.from(grouped.values())

                    setProposals(receivedProposals)
                    setTokenUsage(event.data.usage ?? null)
                    return
                }

                if (event.event === "debug") {
                    finalDebugInfo = event.data

                    if ((event.data.proposalCount || 0) === 0 && !receivedVisibleText) {
                        if (event.data.reason === "tool_validation_failed") {
                            setResponse(getChatDebugMessage(event.data))
                            window.setTimeout(() => setResponse(""), responseOnlyToastCooldownMs)
                        } else {
                            setResponse("No action needed")
                        }
                    }

                    return
                }

                if (event.event === "error") {
                    throw new Error(event.data.error || "AI request failed")
                }
            }

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const chunks = buffer.split("\n\n")
                buffer = chunks.pop() || ""

                for (const chunk of chunks) {
                    const event = parseSSEEvent(chunk)
                    if (event) handleEvent(event)
                }
            }

            const finalEvent = buffer.trim() ? parseSSEEvent(buffer.trim()) : null
            if (finalEvent) handleEvent(finalEvent)

            if (receivedProposals.length === 0) {
                if (finalDebugInfo) {
                    const debugMessage = getChatDebugMessage(finalDebugInfo)
                    const isMeaningfulVisibleText = receivedVisibleText.length >= 12
                    const trimmedReceivedText = receivedText.trim()

                    setResponse((current) => (!isMeaningfulVisibleText || trimmedReceivedText.length < 12 ? debugMessage : current.trim() || debugMessage))
                } else {
                    setResponse("No action needed")
                }

                clearInput()
            }
        } catch (err) {
            setProposals([])
            setResponse("")
            setTokenUsage(null)
            setError(err instanceof Error ? err.message : "AI request failed")
        } finally {
            setIsLoading(false)
        }
    }, [apiRoute, clearInput, mentionsRef, prompt, resetChatState, selectedModel])

    return {
        dismissChat,
        error,
        isLoading,
        proposals,
        resetChatState,
        response,
        setError,
        setProposals,
        setResponse,
        setTokenUsage,
        submit,
        tokenUsage,
    }
}

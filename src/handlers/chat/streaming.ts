import { signAIActionProposal } from "../../features/proposals/signing.js"
import type { ChatDebug, TokenUsage, ToolFailure } from "./types.js"

type ChatDebugPayload = {
    activeLocale?: string
    model: string
    proposalCount: number
    provider: string
    reason: "model_did_not_call_tool" | "proposal_created" | "tool_validation_failed" | "write_intent_without_tool_call"
    selectedLocales: string[]
    toolFailures: ToolFailure[]
    usage?: TokenUsage | null
}

export const createInitialChatDebug = ({ model, provider }: { model: string; provider: string }): ChatDebug => ({
    model,
    provider,
    tools: [
        "getDoc",
        "getGlobal",
        "listCollections",
        "listGlobals",
        "proposeCreateDoc",
        "proposeDeleteDoc",
        "proposeUpdateDoc",
        "proposeUpdateGlobal",
        "searchDocs",
    ],
})

export const createSSEEventStream = (
    events: Array<{
        data: unknown
        event: string
    }>
) => {
    const encoder = new TextEncoder()

    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const { data, event } of events) {
                controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
            }
            controller.close()
        },
    })
}

export const getChatCompletionReason = ({
    proposalCount,
    toolFailures,
    writeIntent,
}: {
    proposalCount: number
    toolFailures: ToolFailure[]
    writeIntent: boolean
}) => {
    if (proposalCount > 0) return "proposal_created" as const
    if (toolFailures.length > 0) return "tool_validation_failed" as const
    if (writeIntent) return "write_intent_without_tool_call" as const
    return "model_did_not_call_tool" as const
}

export const createDebugPayload = ({
    activeLocale,
    debug,
    proposalCount,
    selectedLocales,
    toolFailures,
    usage,
    writeIntent,
}: {
    activeLocale?: string
    debug: ChatDebug
    proposalCount: number
    selectedLocales: string[]
    toolFailures: ToolFailure[]
    usage?: TokenUsage | null
    writeIntent: boolean
}): ChatDebugPayload => ({
    activeLocale,
    model: debug.model,
    proposalCount,
    provider: debug.provider,
    reason: getChatCompletionReason({
        proposalCount,
        toolFailures,
        writeIntent,
    }),
    selectedLocales,
    toolFailures,
    usage,
})

export const createE2EChatResponse = ({ prompt, selectedLocales }: { prompt: string; selectedLocales: string[] }) => {
    const normalizedPrompt = prompt.toLowerCase()
    const wantsCreatePost =
        normalizedPrompt.includes("post") &&
        (normalizedPrompt.includes("create") ||
            normalizedPrompt.includes("erstell") ||
            normalizedPrompt.includes("apply flow") ||
            normalizedPrompt.includes("locale review") ||
            normalizedPrompt.includes("proposal review"))
    const mentionsMars = normalizedPrompt.includes("mars")
    const multipleLocales = selectedLocales.length > 1
    const activeLocale = selectedLocales.at(-1)
    const proposalLabel = multipleLocales
        ? normalizedPrompt.includes("locale review")
            ? "Create localized locale review draft post about Mars"
            : "Create localized draft post about Mars"
        : normalizedPrompt.includes("apply flow")
          ? "Create apply flow draft post about Mars"
          : normalizedPrompt.includes("proposal review")
            ? "Create proposal review draft post about Mars"
            : "Create draft post about Mars"

    const proposal =
        wantsCreatePost && mentionsMars
            ? signAIActionProposal(
                  multipleLocales
                      ? {
                            action: "create",
                            collection: "posts",
                            label: proposalLabel,
                            localizedData: Object.fromEntries(
                                selectedLocales.map((locale) => [
                                    locale,
                                    {
                                        content: locale === "de" ? "Mars ist der vierte Planet von der Sonne." : "Mars is the fourth planet from the Sun.",
                                        excerpt: locale === "de" ? "Ein kurzer Entwurf ueber Mars." : "A short draft about Mars.",
                                        title: locale === "de" ? "Mars im Ueberblick" : "Mars Overview",
                                    },
                                ])
                            ),
                            ...(activeLocale ? { locale: activeLocale } : {}),
                        }
                      : {
                            action: "create",
                            collection: "posts",
                            data: {
                                content: "Mars is the fourth planet from the Sun.",
                                excerpt: "A short draft about Mars.",
                                status: "draft",
                                title: "Mars Overview",
                            },
                            label: proposalLabel,
                            ...(activeLocale ? { locale: activeLocale } : {}),
                        }
              )
            : null

    const responseText = proposal ? "Prepared one draft post proposal." : "No content change was proposed."
    const debugPayload = createDebugPayload({
        debug: {
            model: "e2e-model",
            provider: "openai",
            tools: [],
        },
        proposalCount: proposal ? 1 : 0,
        selectedLocales,
        toolFailures: [],
        usage: {
            inputTokens: 42,
            outputTokens: 27,
            totalTokens: 69,
        },
        writeIntent: wantsCreatePost,
    })

    return new Response(
        createSSEEventStream([
            {
                data: { delta: responseText },
                event: "text",
            },
            {
                data: {
                    proposals: proposal ? [proposal] : [],
                    usage: {
                        inputTokens: 42,
                        outputTokens: 27,
                        totalTokens: 69,
                    },
                },
                event: "proposals",
            },
            {
                data: debugPayload,
                event: "debug",
            },
            {
                data: {},
                event: "done",
            },
        ]),
        {
            headers: {
                "Cache-Control": "no-cache, no-transform",
                Connection: "keep-alive",
                "Content-Type": "text/event-stream; charset=utf-8",
            },
        }
    )
}

"use client"

import { formatAdminURL } from "payload/shared"
import { useEffect, useState } from "react"
import type { MentionOption } from "../MentionPopover.js"
import { isAbortError } from "src/payload/shared.js"

type MentionRange = {
    end: number
    start: number
}

interface DocumentMentionSuggestions {
    apiRoute: string
    documentSuggestionCollection?: null | string
    mentionQuery: string
    mentionRange: MentionRange | null
}

export const useDocumentMentionSuggestions = ({ apiRoute, documentSuggestionCollection, mentionQuery, mentionRange }: DocumentMentionSuggestions) => {
    const [documentSuggestions, setDocumentSuggestions] = useState<MentionOption[]>([])

    useEffect(() => {
        const trimmedQuery = mentionQuery.trim()

        if (!mentionRange || (!trimmedQuery && !documentSuggestionCollection)) {
            setDocumentSuggestions([])
            return
        }

        const abortController = new AbortController()

        const fetchDocumentSuggestions = async () => {
            try {
                const res = await fetch(
                    formatAdminURL({
                        apiRoute,
                        path: "/ai-mention-suggestions",
                    }),
                    {
                        body: JSON.stringify({
                            collectionSlug: documentSuggestionCollection,
                            query: documentSuggestionCollection ? "" : trimmedQuery,
                        }),
                        headers: { "Content-Type": "application/json" },
                        method: "POST",
                        signal: abortController.signal,
                    }
                )

                if (!res.ok) {
                    setDocumentSuggestions([])
                    return
                }

                const result = (await res.json()) as {
                    suggestions?: MentionOption[]
                }

                setDocumentSuggestions(result.suggestions || [])
            } catch (err) {
                if (isAbortError(err)) return

                setDocumentSuggestions([])
            }
        }

        void fetchDocumentSuggestions()

        return () => abortController.abort()
    }, [apiRoute, documentSuggestionCollection, mentionQuery, mentionRange])

    return {
        documentSuggestions,
        resetDocumentSuggestions: () => setDocumentSuggestions([]),
    }
}

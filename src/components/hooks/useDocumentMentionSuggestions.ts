"use client"

import { formatAdminURL } from "payload/shared"
import { useEffect, useState } from "react"
import type { MentionOption } from "../mention-popover/MentionPopover.js"
import { isAbortError } from "../../payload/shared.js"

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

type FetchDocumentMentionSuggestionsOptions = {
    apiRoute: string
    collectionSlug?: null | string
    query: string
    signal: AbortSignal
}

const fetchDocumentMentionSuggestions = async ({ apiRoute, collectionSlug, query, signal }: FetchDocumentMentionSuggestionsOptions) => {
    const res = await fetch(
        formatAdminURL({
            apiRoute,
            path: "/ai-mention-suggestion",
        }),
        {
            body: JSON.stringify({
                collectionSlug,
                query,
            }),
            headers: { "Content-Type": "application/json" },
            method: "POST",
            signal,
        }
    )

    if (!res.ok) return []

    const result = (await res.json()) as {
        suggestions?: MentionOption[]
    }

    return result.suggestions || []
}

export const useDocumentMentionSuggestions = ({ apiRoute, documentSuggestionCollection, mentionQuery, mentionRange }: DocumentMentionSuggestions) => {
    const [documentSuggestions, setDocumentSuggestions] = useState<MentionOption[]>([])
    const trimmedQuery = mentionQuery.trim()
    const shouldLoadSuggestions = Boolean(mentionRange && (trimmedQuery || documentSuggestionCollection))

    useEffect(() => {
        if (!shouldLoadSuggestions) return

        const abortController = new AbortController()

        const loadDocumentSuggestions = async () => {
            try {
                const suggestions = await fetchDocumentMentionSuggestions({
                    apiRoute,
                    collectionSlug: documentSuggestionCollection,
                    query: documentSuggestionCollection ? "" : trimmedQuery,
                    signal: abortController.signal,
                })

                setDocumentSuggestions(suggestions)
            } catch (err) {
                if (isAbortError(err)) return

                setDocumentSuggestions([])
            }
        }

        void loadDocumentSuggestions()

        return () => abortController.abort()
    }, [apiRoute, documentSuggestionCollection, shouldLoadSuggestions, trimmedQuery])

    return {
        documentSuggestions: shouldLoadSuggestions ? documentSuggestions : [],
        resetDocumentSuggestions: () => setDocumentSuggestions([]),
    }
}

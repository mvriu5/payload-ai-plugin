import type { PayloadHandler } from "payload"

import { isCollectionActionAllowed, type ResolvedCollectionPermissionMap } from "../payload/collectionPermissions.js"
import { getDocLabel } from "../payload/shared.js"

type MentionSuggestionsBody = {
    collectionSlug?: string | null
    query?: string
}

type MentionSuggestionsOptions = {
    collections?: ResolvedCollectionPermissionMap
}

type SearchableField = {
    fields?: SearchableField[]
    localized?: boolean
    tabs?: {
        fields?: SearchableField[]
    }[]
}

const getLocaleCodes = (req: Parameters<PayloadHandler>[0]) => {
    const localization = req.payload.config.localization
    if (!localization) return []
    if (Array.isArray(localization.localeCodes)) return localization.localeCodes
    const locales = localization.locales || []

    return locales.flatMap((locale) => {
        if (typeof locale === "string") return [locale]
        if (locale && typeof locale === "object" && "code" in locale && typeof locale.code === "string") return [locale.code]
        return []
    })
}

const hasLocalizedFields = (fields: SearchableField[]): boolean => {
    return fields.some((field) => {
        return Boolean(field.localized) || Boolean(field.fields?.length && hasLocalizedFields(field.fields)) || Boolean(field.tabs?.some((tab) => hasLocalizedFields(tab.fields || [])))
    })
}

export const createMentionSuggestionHandler =
    (options: MentionSuggestionsOptions = {}): PayloadHandler =>
    async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

        const body = req.json ? ((await req.json().catch(() => null)) as MentionSuggestionsBody | null) : null
        const query = body?.query?.trim()
        const collectionSlug = body?.collectionSlug?.trim()

        if (!query && !collectionSlug) return Response.json({ suggestions: [] })

        const suggestions: {
            collection: string
            id: string
            label: string
            slug: string
            type: "doc"
        }[] = []
        const suggestionKeys = new Set<string>()
        const normalizedQuery = query?.toLowerCase()
        const collections = req.payload.config.collections.filter((collection) => {
            if (
                !isCollectionActionAllowed({
                    action: "read",
                    permissions: options.collections,
                    req,
                    slug: collection.slug,
                })
            )
                return false
            if (collectionSlug) return collection.slug === collectionSlug
            return true
        })
        const addSuggestion = ({
            collectionSlug,
            doc,
            requireLabelMatch = false,
            useAsTitle,
        }: {
            collectionSlug: string
            doc: Record<string, unknown>
            requireLabelMatch?: boolean
            useAsTitle?: string
        }) => {
            const id = doc.id?.toString()
            if (!id) return

            const key = `${collectionSlug}:${id}`
            if (suggestionKeys.has(key)) return

            const label = getDocLabel(doc, useAsTitle)
            if (requireLabelMatch && normalizedQuery && !label.toLowerCase().includes(normalizedQuery)) return

            suggestionKeys.add(key)
            suggestions.push({
                collection: collectionSlug,
                id,
                label,
                slug: key,
                type: "doc",
            })
        }

        for (const collection of collections) {
            if (suggestions.length >= 5) break

            const collectionFields = collection.fields as SearchableField[]
            const localeCodes = query && hasLocalizedFields(collectionFields) ? getLocaleCodes(req) : []
            const localesToSearch = localeCodes.length > 0 ? localeCodes : [null]

            for (const locale of localesToSearch) {
                if (suggestions.length >= 5) break

                const result = await req.payload.find({
                    collection: collection.slug as never,
                    depth: 0,
                    limit: query ? 100 : 10,
                    ...(locale ? { locale } : {}),
                    overrideAccess: false,
                    req,
                })

                for (const doc of result.docs as Record<string, unknown>[]) {
                    if (suggestions.length >= 5) break

                    addSuggestion({
                        collectionSlug: collection.slug,
                        doc,
                        requireLabelMatch: Boolean(normalizedQuery),
                        useAsTitle: collection.admin?.useAsTitle,
                    })
                }
            }
        }

        return Response.json({ suggestions: suggestions.slice(0, 5) })
    }

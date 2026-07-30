import type { PayloadHandler } from "payload"

import { getCollectionSlugsForAction, type ResolvedCollectionPermissionMap } from "../collectionPermissions.js"
import { isInternalCollection } from "../../utils/data.js"
import { describeCollectionLikeConfig, type CollectionLikeConfig } from "./description.js"
import { loadMentionDocuments } from "./mentionDocuments.js"
import type { SchemaContextRegistry, SchemaRegistrySource } from "./registry.js"

export type ChatMention = {
    collection?: string
    id?: string
    label?: string
    parent?: string
    slug?: string
    type?: "block" | "collection" | "doc" | "global" | "locale"
}

export const getAllowedCollectionSlugs = (req: Parameters<PayloadHandler>[0], collections?: ResolvedCollectionPermissionMap) =>
    getCollectionSlugsForAction({
        action: "read",
        permissions: collections,
        req,
    })

export const getMentionContext = async <Collection extends SchemaRegistrySource, Global extends SchemaRegistrySource>({
    collections,
    mentions,
    registry,
    req,
}: {
    collections?: ResolvedCollectionPermissionMap
    mentions?: ChatMention[]
    registry: SchemaContextRegistry<Collection, Global>
    req: Parameters<PayloadHandler>[0]
}) => {
    if (!mentions?.length) return []

    const context: Record<string, unknown>[] = []
    const seen = new Set<string>()
    const selectedLocales = [...new Set(mentions.flatMap((mention) => (mention.type === "locale" && mention.slug ? [mention.slug] : [])))]
    const activeLocale = selectedLocales.at(-1)
    const limitedMentions = mentions.slice(0, 8)
    const docsByMentionKey = await loadMentionDocuments({
        activeLocale,
        mentions: limitedMentions,
        registry,
        req,
    })

    if (registry.localeConfigs.length > 0) {
        context.push({
            activeLocale,
            defaultLocale: registry.localeConfigs.find((locale) => locale.isDefault)?.code,
            locales: registry.localeConfigs,
            selectedLocales,
            type: "locales",
        })
    }

    for (const mention of limitedMentions) {
        if (mention.type === "locale" && mention.slug) {
            const locale = registry.localeConfigsByCode.get(mention.slug)
            if (!locale || seen.has(`locale:${locale.code}`)) continue

            seen.add(`locale:${locale.code}`)
            context.push({ ...locale, type: "locale" })
        }

        if (mention.type === "collection" && mention.slug) {
            const key = `collection:${mention.slug}`
            const config = registry.collectionConfigsBySlug.get(mention.slug)
            if (seen.has(key) || isInternalCollection(mention.slug) || !config) continue

            seen.add(key)
            context.push(
                describeCollectionLikeConfig({
                    config: config as CollectionLikeConfig,
                    permissions: collections,
                    type: "collection",
                })
            )
        }

        if (mention.type === "global" && mention.slug) {
            const key = `global:${mention.slug}`
            const config = registry.globalConfigsBySlug.get(mention.slug)
            if (seen.has(key) || !config) continue

            seen.add(key)
            context.push({
                ...describeCollectionLikeConfig({ config: config as CollectionLikeConfig, type: "global" }),
                doc: docsByMentionKey.get(key) ?? null,
            })
        }

        if (mention.type === "block" && mention.slug) {
            const matchingBlocks = (registry.blocksBySlug.get(mention.slug) || []).filter((block) => !mention.parent || block.parent === mention.parent)

            for (const block of matchingBlocks) {
                const key = `block:${block.parent}:${block.slug}`
                if (seen.has(key)) continue

                seen.add(key)
                context.push({ ...block, type: "block" })
            }
        }

        if (mention.type === "doc" && mention.collection && mention.id) {
            const key = `doc:${mention.collection}:${mention.id}`
            const doc = docsByMentionKey.get(key)
            if (seen.has(key) || isInternalCollection(mention.collection) || !registry.collectionSlugSet.has(mention.collection) || !doc) continue

            seen.add(key)
            context.push({
                collection: mention.collection,
                doc,
                id: mention.id,
                label: mention.label || mention.id,
                ...(activeLocale ? { locale: activeLocale } : {}),
                type: "doc",
            })
        }
    }

    return context
}

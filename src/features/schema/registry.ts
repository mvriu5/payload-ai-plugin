import type { PayloadHandler } from "payload"

import { getSerializableLabel, isRecord } from "../../utils/data.js"
import { collectBlocks, type CollectionLikeConfig } from "./description.js"

export type LocaleConfig = {
    code: string
    isDefault?: boolean
    label: string
}

export type SchemaBlockContext = Record<string, unknown> & {
    parent: string
    slug: string
}

export type SchemaRegistrySource = {
    fields?: unknown[]
    slug: string
}

export type SchemaContextRegistry<
    Collection extends SchemaRegistrySource = CollectionLikeConfig,
    Global extends SchemaRegistrySource = CollectionLikeConfig,
> = {
    blocks: SchemaBlockContext[]
    blocksBySlug: Map<string, SchemaBlockContext[]>
    collectionConfigsBySlug: Map<string, Collection>
    collectionSlugSet: Set<string>
    globalConfigsBySlug: Map<string, Global>
    globalSlugSet: Set<string>
    localeConfigs: LocaleConfig[]
    localeConfigsByCode: Map<string, LocaleConfig>
}

const getLocaleConfigs = (req: Parameters<PayloadHandler>[0]): LocaleConfig[] => {
    const localization = (req.payload.config as { localization?: { defaultLocale?: string; locales?: unknown[] } }).localization
    const defaultLocale = localization?.defaultLocale

    return (localization?.locales || []).flatMap((locale) => {
        if (typeof locale === "string") {
            return [{ code: locale, ...(locale === defaultLocale ? { isDefault: true } : {}), label: locale }]
        }
        if (!isRecord(locale)) return []

        const code = typeof locale.code === "string" ? locale.code : typeof locale.label === "string" ? locale.label : undefined
        if (!code) return []

        return [
            {
                code,
                ...(code === defaultLocale ? { isDefault: true } : {}),
                label: "label" in locale ? getSerializableLabel(locale.label, code) : code,
            },
        ]
    })
}

export const createSchemaContextRegistry = <Collection extends SchemaRegistrySource, Global extends SchemaRegistrySource>({
    collections,
    globals,
    req,
}: {
    collections: Collection[]
    globals: Global[]
    req: Parameters<PayloadHandler>[0]
}): SchemaContextRegistry<Collection, Global> => {
    const collectionConfigs = collections as CollectionLikeConfig[]
    const globalConfigs = globals as CollectionLikeConfig[]
    const blocks = [
        ...collectionConfigs.flatMap((collection) => collectBlocks({ fields: collection.fields || [], parent: collection.slug })),
        ...globalConfigs.flatMap((global) => collectBlocks({ fields: global.fields || [], parent: global.slug })),
    ]
    const blocksBySlug = new Map<string, SchemaBlockContext[]>()

    for (const block of blocks) {
        const matchingBlocks = blocksBySlug.get(block.slug) || []
        matchingBlocks.push(block)
        blocksBySlug.set(block.slug, matchingBlocks)
    }

    const collectionConfigsBySlug = new Map(collections.map((collection) => [collection.slug, collection]))
    const globalConfigsBySlug = new Map(globals.map((global) => [global.slug, global]))
    const localeConfigs = getLocaleConfigs(req)

    return {
        blocks,
        blocksBySlug,
        collectionConfigsBySlug,
        collectionSlugSet: new Set(collectionConfigsBySlug.keys()),
        globalConfigsBySlug,
        globalSlugSet: new Set(globalConfigsBySlug.keys()),
        localeConfigs,
        localeConfigsByCode: new Map(localeConfigs.map((locale) => [locale.code, locale])),
    }
}

import type { PayloadHandler } from "payload"

import { isInternalCollection } from "../../utils/data.js"
import type { SchemaContextRegistry } from "./registry.js"

type MentionDocumentReference = {
    collection?: string
    id?: string
    slug?: string
    type?: string
}

type MentionDocumentRequest =
    | {
          collection: string
          id: string
          key: string
          type: "doc"
      }
    | {
          key: string
          slug: string
          type: "global"
      }

export const loadMentionDocuments = async ({
    activeLocale,
    mentions,
    registry,
    req,
}: {
    activeLocale?: string
    mentions: MentionDocumentReference[]
    registry: Pick<SchemaContextRegistry, "collectionSlugSet" | "globalSlugSet">
    req: Parameters<PayloadHandler>[0]
}) => {
    const requests = new Map<string, MentionDocumentRequest>()

    for (const mention of mentions) {
        if (mention.type === "global" && mention.slug && registry.globalSlugSet.has(mention.slug)) {
            const request = {
                key: `global:${mention.slug}`,
                slug: mention.slug,
                type: "global" as const,
            }
            requests.set(request.key, request)
        }

        if (
            mention.type === "doc" &&
            mention.collection &&
            mention.id &&
            !isInternalCollection(mention.collection) &&
            registry.collectionSlugSet.has(mention.collection)
        ) {
            const request = {
                collection: mention.collection,
                id: mention.id,
                key: `doc:${mention.collection}:${mention.id}`,
                type: "doc" as const,
            }
            requests.set(request.key, request)
        }
    }

    const results = await Promise.all(
        [...requests.values()].map(async (request) => {
            const doc =
                request.type === "global"
                    ? await req.payload
                          .findGlobal({
                              depth: 2,
                              ...(activeLocale ? { locale: activeLocale } : {}),
                              overrideAccess: false,
                              req,
                              slug: request.slug as never,
                          })
                          .catch(() => null)
                    : await req.payload
                          .findByID({
                              collection: request.collection as never,
                              depth: 2,
                              id: request.id,
                              ...(activeLocale ? { locale: activeLocale } : {}),
                              overrideAccess: false,
                              req,
                          })
                          .catch(() => null)

            return [request.key, doc] as const
        })
    )

    return new Map<string, unknown>(results)
}

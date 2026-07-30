import { describe, expect, it, vi } from "vitest"

import { createSchemaContextRegistry, getMentionContext } from "../../../../src/features/schema/context.js"
import { createMockRequest } from "../../../fixtures/handler.js"
import { localizedConfig, postsCollection } from "../../../fixtures/payloadConfig.js"

describe("schema mention context", () => {
    it("reuses registry metadata and loads duplicate document mentions once", async () => {
        const findByID = vi.fn().mockResolvedValue({ id: "4", title: "Mars" })
        const req = createMockRequest({
            collections: [postsCollection],
            findByID,
            localization: localizedConfig,
        })
        const registry = createSchemaContextRegistry({
            collections: [postsCollection],
            globals: [],
            req,
        })
        const mentions = [
            { slug: "de", type: "locale" as const },
            { collection: "posts", id: "4", label: "Mars", type: "doc" as const },
            { collection: "posts", id: "4", label: "Mars duplicate", type: "doc" as const },
        ]

        const context = await getMentionContext({
            mentions,
            registry,
            req,
        })

        expect(findByID).toHaveBeenCalledTimes(1)
        expect(findByID).toHaveBeenCalledWith({
            collection: "posts",
            depth: 2,
            id: "4",
            locale: "de",
            overrideAccess: false,
            req,
        })
        expect(context.filter((entry) => entry.type === "doc")).toHaveLength(1)
        expect(context).toContainEqual(
            expect.objectContaining({
                activeLocale: "de",
                defaultLocale: "en",
                selectedLocales: ["de"],
                type: "locales",
            })
        )
    })
})

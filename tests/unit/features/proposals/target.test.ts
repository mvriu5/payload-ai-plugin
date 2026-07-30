import { describe, expect, it, vi } from "vitest"

import { prepareLocalizedTargetUpdates, resolveProposalTarget } from "../../../../src/features/proposals/target.js"
import type { ActionProposal } from "../../../../src/features/proposals/types.js"
import { createMockRequest } from "../../../fixtures/handler.js"
import { postsCollection, siteSettingsGlobal } from "../../../fixtures/payloadConfig.js"

describe("proposal targets", () => {
    it("uses access-controlled Payload operations for collection targets", async () => {
        const findByID = vi.fn().mockResolvedValue({ id: "4", title: "Old" })
        const update = vi.fn().mockResolvedValue({ id: "4", title: "New" })
        const req = createMockRequest({
            collections: [postsCollection],
            findByID,
            update,
        })
        const proposal: ActionProposal = {
            action: "update",
            collection: "posts",
            data: { title: "New" },
            id: "4",
            label: "Update post",
        }
        const target = resolveProposalTarget({ proposal, req })

        expect(target?.type).toBe("collection")
        await target?.read({ locale: "de" })
        await target?.update({ title: "New" }, "de")

        expect(findByID).toHaveBeenCalledWith({
            collection: "posts",
            depth: 2,
            id: "4",
            locale: "de",
            overrideAccess: false,
            req,
        })
        expect(update).toHaveBeenCalledWith({
            collection: "posts",
            data: { title: "New" },
            id: "4",
            locale: "de",
            overrideAccess: false,
            req,
        })
    })

    it("loads the default locale once and reuses it for localized fallbacks", async () => {
        const localizedCollection = {
            ...postsCollection,
            fields: [
                ...postsCollection.fields,
                {
                    localized: true,
                    name: "summary",
                    required: true,
                    type: "text",
                },
            ],
        }
        const findByID = vi
            .fn()
            .mockImplementation(({ locale }: { locale?: string }) =>
                Promise.resolve(locale === "en" ? { id: "4", summary: "English summary", title: "Old" } : { id: "4", title: "Alt" })
            )
        const req = createMockRequest({
            collections: [localizedCollection],
            findByID,
        })
        const proposal: ActionProposal = {
            action: "update",
            collection: "posts",
            id: "4",
            label: "Translate post",
            localizedData: {
                de: { title: "Neu" },
                en: { title: "New" },
            },
        }
        const target = resolveProposalTarget({ proposal, req })

        if (!target) throw new Error("Expected proposal target")
        const entries = await prepareLocalizedTargetUpdates({
            defaultLocale: "en",
            localizedData: proposal.localizedData,
            target,
        })

        expect(findByID).toHaveBeenCalledTimes(2)
        expect(entries.find(({ locale }) => locale === "de")?.data).toEqual({
            summary: "English summary",
            title: "Neu",
        })
    })

    it("resolves global reads and writes through the same target interface", async () => {
        const findGlobal = vi.fn().mockResolvedValue({ siteName: "Old" })
        const updateGlobal = vi.fn().mockResolvedValue({ siteName: "New" })
        const req = createMockRequest({
            findGlobal,
            globals: [siteSettingsGlobal],
            updateGlobal,
        })
        const proposal: ActionProposal = {
            action: "updateGlobal",
            data: { siteName: "New" },
            label: "Update settings",
            slug: "site-settings",
        }
        const target = resolveProposalTarget({ proposal, req })

        expect(target?.type).toBe("global")
        await target?.read()
        await target?.update({ siteName: "New" })

        expect(findGlobal).toHaveBeenCalledWith({
            depth: 2,
            overrideAccess: false,
            req,
            slug: "site-settings",
        })
        expect(updateGlobal).toHaveBeenCalledWith({
            data: { siteName: "New" },
            overrideAccess: false,
            req,
            slug: "site-settings",
        })
    })
})

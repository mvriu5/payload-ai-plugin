import { afterEach, describe, expect, it, vi } from "vitest"

import { createMediaUploadHandler } from "../../src/handlers/mediaUploadHandler.js"
import { createMockRequest, readJSON } from "../fixtures/handler.js"

const mockAddDataAndFileToRequest = vi.hoisted(() => vi.fn())

vi.mock("payload", () => ({
    addDataAndFileToRequest: mockAddDataAndFileToRequest,
}))

const mediaCollection = {
    fields: [],
    slug: "media",
    upload: true,
}

const file = {
    data: Buffer.from("test"),
    mimetype: "image/png",
    name: "hero.png",
    size: 512,
}

describe("createMediaUploadHandler", () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it("creates an upload document with access control enforced", async () => {
        const create = vi.fn().mockResolvedValue({
            filename: "hero.png",
            filesize: 512,
            id: "media-1",
            mimeType: "image/png",
            url: "/media/hero.png",
        })
        const req = createMockRequest({
            collections: [mediaCollection],
            create,
        })
        mockAddDataAndFileToRequest.mockImplementation(async (incomingReq) => {
            incomingReq.data = {
                alt: "Hero image",
                collection: "posts",
                file: "ignored",
            }
            incomingReq.file = file
        })

        const handler = createMediaUploadHandler({
            collectionSlug: "media",
        })
        const response = await handler(req)
        const result = await readJSON<{
            attachment: {
                collection: string
                filename: string
                filesize: number
                id: string
                mimeType: string
                type: string
                url: string
            }
        }>(response)

        expect(response.status).toBe(200)
        expect(create).toHaveBeenCalledWith({
            collection: "media",
            data: {
                alt: "Hero image",
            },
            file,
            overrideAccess: false,
            req,
        })
        expect(result.attachment).toEqual({
            collection: "media",
            filename: "hero.png",
            filesize: 512,
            id: "media-1",
            mimeType: "image/png",
            type: "media",
            url: "/media/hero.png",
        })
    })

    it("rejects missing files", async () => {
        const req = createMockRequest({
            collections: [mediaCollection],
        })
        mockAddDataAndFileToRequest.mockResolvedValue(undefined)

        const handler = createMediaUploadHandler({
            collectionSlug: "media",
        })
        const response = await handler(req)
        const result = await readJSON<{ error: string }>(response)

        expect(response.status).toBe(400)
        expect(result.error).toBe("File is required")
    })

    it("rejects collections that are not configured for uploads", async () => {
        const req = createMockRequest({
            collections: [
                {
                    fields: [],
                    slug: "posts",
                },
            ],
        })
        mockAddDataAndFileToRequest.mockImplementation(async (incomingReq) => {
            incomingReq.file = file
        })

        const handler = createMediaUploadHandler({
            collectionSlug: "posts",
        })
        const response = await handler(req)
        const result = await readJSON<{ error: string }>(response)

        expect(response.status).toBe(400)
        expect(result.error).toBe("Collection is not upload-enabled: posts")
    })

    it("enforces size and mime limits", async () => {
        const req = createMockRequest({
            collections: [mediaCollection],
        })
        mockAddDataAndFileToRequest.mockImplementation(async (incomingReq) => {
            incomingReq.file = file
        })

        const tooLarge = createMediaUploadHandler({
            collectionSlug: "media",
            maxFileSize: 128,
        })
        const sizeResponse = await tooLarge(req)

        expect(sizeResponse.status).toBe(413)

        const wrongMime = createMediaUploadHandler({
            acceptedMimeTypes: ["application/pdf"],
            collectionSlug: "media",
        })
        const mimeResponse = await wrongMime(req)
        const mimeResult = await readJSON<{ error: string }>(mimeResponse)

        expect(mimeResponse.status).toBe(415)
        expect(mimeResult.error).toBe("File type is not accepted: image/png")
    })
})

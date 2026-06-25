import { addDataAndFileToRequest, type PayloadHandler } from "payload"

import { getNumber, getString, isRecord } from "../payload/shared.js"

export type MediaUploadOptions = {
    acceptedMimeTypes?: string[]
    collectionSlug: string
    maxFileSize?: number
}

type UploadedFile = {
    mimetype?: string
    name?: string
    size?: number
}

type RequestWithUpload = Parameters<PayloadHandler>[0] & {
    data?: unknown
    file?: UploadedFile
}

const mimeTypeMatches = (mimeType: string, acceptedMimeType: string) => {
    if (acceptedMimeType === mimeType) return true
    if (!acceptedMimeType.endsWith("/*")) return false

    return mimeType.startsWith(`${acceptedMimeType.slice(0, -2)}/`)
}

const isAcceptedMimeType = (mimeType: string, acceptedMimeTypes?: string[]) => {
    if (!acceptedMimeTypes || acceptedMimeTypes.length === 0) return true

    return acceptedMimeTypes.some((acceptedMimeType) => mimeTypeMatches(mimeType, acceptedMimeType))
}

const getUploadData = (data: unknown) => {
    if (!isRecord(data)) return {}

    const { collection: _collection, file: _file, ...uploadData } = data

    return uploadData
}

const getMediaAttachment = ({ collectionSlug, doc, file }: { collectionSlug: string; doc: unknown; file: UploadedFile }) => {
    const record = isRecord(doc) ? doc : {}
    const id = record.id

    return {
        collection: collectionSlug,
        filename: getString(record.filename) || file.name || "",
        filesize: getNumber(record.filesize) || file.size || 0,
        id: typeof id === "string" || typeof id === "number" ? String(id) : "",
        mimeType: getString(record.mimeType) || file.mimetype || "",
        type: "media" as const,
        url: getString(record.url),
    }
}

export const createMediaUploadHandler =
    ({ acceptedMimeTypes, collectionSlug, maxFileSize }: MediaUploadOptions): PayloadHandler =>
    async (req) => {
        const uploadReq = req as RequestWithUpload

        try {
            await addDataAndFileToRequest(uploadReq)

            const collectionConfig = uploadReq.payload.config.collections.find((collection) => collection.slug === collectionSlug)

            if (!collectionConfig) {
                return Response.json({ error: `Upload collection not found: ${collectionSlug}` }, { status: 400 })
            }

            if (!collectionConfig.upload) {
                return Response.json({ error: `Collection is not upload-enabled: ${collectionSlug}` }, { status: 400 })
            }

            const file = uploadReq.file

            if (!file) {
                return Response.json({ error: "File is required" }, { status: 400 })
            }

            const fileSize = typeof file.size === "number" && Number.isFinite(file.size) ? file.size : 0

            if (maxFileSize && fileSize > maxFileSize) {
                return Response.json({ error: `File exceeds max size of ${maxFileSize} bytes` }, { status: 413 })
            }

            const mimeType = file.mimetype || ""

            if (mimeType && !isAcceptedMimeType(mimeType, acceptedMimeTypes)) {
                return Response.json({ error: `File type is not accepted: ${mimeType}` }, { status: 415 })
            }

            const doc = await uploadReq.payload.create({
                collection: collectionSlug as never,
                data: getUploadData(uploadReq.data),
                file: file as never,
                overrideAccess: false,
                req: uploadReq,
            })

            return Response.json({
                attachment: getMediaAttachment({
                    collectionSlug,
                    doc,
                    file,
                }),
                doc,
            })
        } catch (err) {
            uploadReq.payload.logger.error({
                err,
                msg: "AI media upload failed",
            })

            return Response.json({ error: "Media upload failed." }, { status: 500 })
        }
    }

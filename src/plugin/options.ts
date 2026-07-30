import type { MediaUploadOptions } from "../handlers/mediaUploadHandler.js"
import type { PayloadAIPluginOptions } from "./types.js"

export const resolveMediaUploadOptions = (media?: PayloadAIPluginOptions["media"]): MediaUploadOptions | null => {
    if (!media || media.enabled === false) return null

    return {
        ...(media.acceptedMimeTypes ? { acceptedMimeTypes: media.acceptedMimeTypes } : {}),
        collectionSlug: media.collectionSlug || "media",
        ...(typeof media.maxFileSize === "number" && Number.isFinite(media.maxFileSize) && media.maxFileSize > 0
            ? { maxFileSize: Math.floor(media.maxFileSize) }
            : {}),
    }
}

export const resolveMaxOutputTokens = (maxOutputTokens?: number) =>
    typeof maxOutputTokens === "number" && Number.isFinite(maxOutputTokens) && maxOutputTokens > 0 ? Math.floor(maxOutputTokens) : undefined

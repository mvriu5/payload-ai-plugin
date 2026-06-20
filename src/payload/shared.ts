import type { PayloadHandler } from "payload"

export type LocalizedDataInput = Record<string, Record<string, unknown>>

export type AIActionProposalLike = {
    action: "create" | "delete" | "update" | "updateGlobal"
    collection?: string
    data?: Record<string, unknown>
    id?: string
    label: string
    locale?: string
    localizedData?: LocalizedDataInput
    slug?: string
}

const maxProposalLabelLength = 90

export const getSerializableLabel = (label: unknown, fallback = "") => {
    if (typeof label === "string") return label

    if (label && typeof label === "object") {
        const firstLabel = Object.values(label).find((value) => typeof value === "string")

        if (typeof firstLabel === "string") return firstLabel
    }

    return fallback
}

export const isInternalCollection = (slug: string) => {
    return slug.startsWith("payload-") || slug === "plugin-collection"
}

export const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

export const mergeData = (current: Record<string, unknown>, next: Record<string, unknown>): Record<string, unknown> => {
    return Object.fromEntries(
        Object.entries({
            ...current,
            ...next,
        }).map(([key, value]) => {
            const currentValue = current[key]

            if (isRecord(currentValue) && isRecord(value)) {
                return [key, mergeData(currentValue, value)]
            }

            return [key, value]
        })
    )
}

export const isKnownGlobal = (req: Parameters<PayloadHandler>[0], slug: string) => {
    return req.payload.config.globals?.some((item) => item.slug === slug) || false
}

export const hasLocalizedData = <Value>(value: Value): value is Value & { localizedData: LocalizedDataInput } => {
    return isRecord(value) && isRecord(value.localizedData)
}

export const getDefaultLocale = (req: Parameters<PayloadHandler>[0]) => {
    const localization = req.payload.config.localization

    if (!localization) return null

    return localization.defaultLocale || null
}

export const getJSONLineKey = (line: string) => {
    const match = /^(\s*)"([^"]+)":/.exec(line)

    return match ? `${match[1]}${match[2]}` : null
}

const isNonEmptyString = (value: unknown): value is string => {
    return typeof value === "string" && value.trim().length > 0
}

const hasWriteData = (proposal: Record<string, unknown>) => {
    const hasData = isRecord(proposal.data)
    const hasLocalizedProposalData = hasLocalizedData(proposal)

    return hasData !== hasLocalizedProposalData
}

export const isActionProposal = (proposal: unknown): proposal is AIActionProposalLike => {
    if (!isRecord(proposal) || !isNonEmptyString(proposal.label)) return false

    if (proposal.action === "create") {
        return isNonEmptyString(proposal.collection) && hasWriteData(proposal)
    }

    if (proposal.action === "update") {
        return isNonEmptyString(proposal.collection) && isNonEmptyString(proposal.id) && hasWriteData(proposal)
    }

    if (proposal.action === "delete") {
        return isNonEmptyString(proposal.collection) && isNonEmptyString(proposal.id)
    }

    if (proposal.action === "updateGlobal") {
        return isNonEmptyString(proposal.slug) && hasWriteData(proposal)
    }

    return false
}

export const getOptionalNumber = (value: unknown) => {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export const getNumber = (value: unknown) => {
    return typeof value === "number" && Number.isFinite(value) ? value : 0
}

export const getString = (value: unknown) => {
    return typeof value === "string" ? value : null
}

export const getDocLabel = (doc: Record<string, unknown>, useAsTitle?: string) => {
    const titleField = useAsTitle ? getSerializableLabel(doc[useAsTitle]) : ""
    const title = getSerializableLabel(doc.title)
    const name = getSerializableLabel(doc.name)
    const email = getSerializableLabel(doc.email)

    return titleField || title || name || email || doc.id?.toString() || "Untitled"
}

export const getOptionValue = (option?: string | { label?: unknown; value?: string }) => {
    if (!option) return undefined
    if (typeof option === "string") return option
    return typeof option.value === "string" ? option.value : undefined
}

export const hasValueAtPath = (data: Record<string, unknown>, path: string) => {
    const segments = path.split(".")
    let current: unknown = data

    for (const segment of segments) {
        if (!isRecord(current) || current[segment] === undefined) {
            return false
        }

        current = current[segment]
    }

    return true
}

export const getSafeProposalLabel = (label: string) => {
    const firstLine = label
        .replace(/[*_`>#-]/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find(Boolean)

    if (!firstLine) return "Review proposed CMS change"
    if (firstLine.length <= maxProposalLabelLength) return firstLine

    return `${firstLine.slice(0, maxProposalLabelLength - 3).trim()}...`
}

export const setValueAtPath = (data: Record<string, unknown>, path: string, value: unknown) => {
    const segments = path.split(".")
    let current = data

    for (const segment of segments.slice(0, -1)) {
        const next = current[segment]

        if (!isRecord(next)) {
            current[segment] = {}
        }

        current = current[segment] as Record<string, unknown>
    }

    current[segments[segments.length - 1]] = value
}

export const isAbortError = (err: unknown) => {
    return err instanceof DOMException && err.name === "AbortError"
}

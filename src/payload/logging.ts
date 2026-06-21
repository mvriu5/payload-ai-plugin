import type { PayloadHandler } from "payload"

type LogLevel = "error" | "info" | "warn"

type LogEntry = {
    [key: string]: unknown
    msg: string
}

const maxPreviewLength = 180

export const getLogPreview = (value?: string | null) => {
    if (!value) return null

    const trimmed = value.trim()

    if (!trimmed) return null
    if (trimmed.length <= maxPreviewLength) return trimmed

    return `${trimmed.slice(0, maxPreviewLength).trim()}...`
}

export const logHandlerEvent = (req: Parameters<PayloadHandler>[0], level: LogLevel, entry: LogEntry) => {
    const logger = req.payload?.logger as Partial<Record<LogLevel, (value: Record<string, unknown>) => void>> | undefined

    const log = logger?.[level]
    if (typeof log !== "function") return

    log(entry)
}

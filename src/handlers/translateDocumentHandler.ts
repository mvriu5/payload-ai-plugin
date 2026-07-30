import { isDeepStrictEqual } from "node:util"

import { generateText } from "ai"
import type { PayloadHandler } from "payload"

import { resolveAIRequestContext, type AIRequestOptions, type AIRequestUser } from "../features/providers/requestContext.js"
import { getTranslationValues, type TranslationPageContext } from "../features/content/documentTranslation.js"

type TranslateDocumentOptions = AIRequestOptions & {
    maxOutputTokens?: number
    pageContexts: Map<string, TranslationPageContext>
}

type TranslateDocumentBody = {
    action?: "status" | "translate"
    id?: number | string
    locale?: string
    model?: string
    provider?: string
    scope?: {
        slug?: string
        type?: "collection" | "global"
    }
}

const getDefaultLocale = (req: Parameters<PayloadHandler>[0]) => {
    const localization = req.payload.config.localization
    if (!localization) return null
    return localization.defaultLocale || null
}

const loadDocument = async ({
    context,
    id,
    locale,
    req,
}: {
    context: TranslationPageContext
    id?: number | string
    locale: string
    req: Parameters<PayloadHandler>[0]
}) => {
    if (context.type === "collection") {
        if (id === undefined || id === null || id === "") return null
        return req.payload.findByID({
            collection: context.slug as never,
            depth: 0,
            fallbackLocale: false,
            id,
            locale: locale as never,
            overrideAccess: false,
            req,
        })
    }

    return req.payload.findGlobal({
        depth: 0,
        fallbackLocale: false,
        locale: locale as never,
        overrideAccess: false,
        req,
        slug: context.slug as never,
    })
}

const parseTranslations = (text: string, sourceCount: number) => {
    const value = text
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
    const parsed = JSON.parse(value) as { translations?: Record<string, unknown> }
    if (!parsed.translations || typeof parsed.translations !== "object") throw new Error("Invalid translation response.")

    return Array.from({ length: sourceCount }, (_, index) => parsed.translations?.[String(index)])
}

export const createTranslateDocumentHandler =
    (options: TranslateDocumentOptions): PayloadHandler =>
    async (req) => {
        if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 })

        const body = req.json ? ((await req.json().catch(() => null)) as TranslateDocumentBody | null) : null
        const locale = body?.locale?.trim()
        const scopeSlug = body?.scope?.slug?.trim()
        const scopeType = body?.scope?.type
        if (!body?.action || !locale || !scopeSlug || !scopeType) {
            return Response.json({ error: "Action, locale, and page scope are required." }, { status: 400 })
        }

        const pageContext = options.pageContexts.get(`${scopeType}:${scopeSlug}`)
        const defaultLocale = getDefaultLocale(req)
        if (!pageContext || !defaultLocale || locale === defaultLocale) {
            return Response.json({ available: false })
        }

        try {
            // Payload derives locale state on the request, so reads sharing one req must not run concurrently.
            const sourceDocument = await loadDocument({ context: pageContext, id: body.id, locale: defaultLocale, req })
            const sourceValues = getTranslationValues(pageContext.fields, sourceDocument)
            if (sourceValues.length === 0) return Response.json({ available: false })

            const targetDocument = await loadDocument({ context: pageContext, id: body.id, locale, req })
            const targetValuesByPath = new Map(getTranslationValues(pageContext.fields, targetDocument).map((entry) => [entry.path, entry.value]))
            const translationSourceValues = sourceValues.filter((entry) => {
                const targetValue = targetValuesByPath.get(entry.path)
                return targetValue === undefined || isDeepStrictEqual(targetValue, entry.value)
            })
            const available = translationSourceValues.length > 0

            if (body.action === "status" || !available) return Response.json({ available })

            const aiRequestResolution = await resolveAIRequestContext({
                options,
                req,
                requestedModel: body.model,
                requestedProvider: body.provider,
                user: req.user as AIRequestUser,
            })
            if (!aiRequestResolution.ok) {
                return Response.json(
                    { error: aiRequestResolution.error.message },
                    { status: aiRequestResolution.error.code === "token_limit" ? 429 : 400 }
                )
            }
            const aiRequest = aiRequestResolution.context
            const model = await aiRequest.loadModel()
            const result = await generateText({
                maxOutputTokens: options.maxOutputTokens || 700,
                model,
                prompt: JSON.stringify({
                    sourceLocale: defaultLocale,
                    targetLocale: locale,
                    values: translationSourceValues.map((entry, index) => ({
                        id: String(index),
                        value: entry.value,
                    })),
                }),
                system: [
                    "Translate the human-readable content in every value to the target locale.",
                    "Preserve JSON structure, keys, IDs, URLs, numbers, booleans, nulls, and Lexical rich-text structure exactly.",
                    'Return strict JSON in the shape {"translations":{"0":translatedValue}} with one entry for every input ID.',
                    "Return no Markdown or explanation.",
                ].join(" "),
            })
            const translatedValues = parseTranslations(result.text, translationSourceValues.length)
            if (translatedValues.some((value) => value === undefined)) throw new Error("Translation response is incomplete.")

            if (result.usage) await aiRequest.recordUsage(result.usage)

            return Response.json({
                available: true,
                values: translationSourceValues.map((entry, index) => ({
                    fieldType: entry.fieldType,
                    path: entry.path,
                    value: translatedValues[index],
                })),
            })
        } catch (error) {
            req.payload.logger.error({
                err: error,
                msg: "AI document translation failed",
                scopeSlug,
                scopeType,
            })
            return Response.json({ error: "AI document translation failed." }, { status: 500 })
        }
    }

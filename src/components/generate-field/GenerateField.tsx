"use client"

import { useConfig, useDocumentForm, useDocumentInfo, useField, useLocale } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import { useState } from "react"

import { createGeneratedRichTextValue, type GeneratedRichTextValue } from "./richText.js"
import styles from "./GenerateField.module.css"

type GenerateFieldProps = {
    field?: {
        hasMany?: boolean
    }
    generationFieldKey: string
    generationFieldType: "json" | "richText" | "text" | "textarea"
    path: string
    readOnly?: boolean
}

type GeneratedValueResponse = {
    error?: string
    value?: unknown
}

type ClientConfig = {
    routes?: {
        api?: string
    }
}

const pendingRequests = new Map<string, Promise<GeneratedValueResponse>>()

const requestGeneratedValue = ({ apiRoute, body, cacheKey }: { apiRoute: string; body: Record<string, unknown>; cacheKey: string }) => {
    const pending = pendingRequests.get(cacheKey)
    if (pending) return pending

    const request = fetch(
        formatAdminURL({
            apiRoute,
            path: "/ai-generate-field",
        }),
        {
            body: JSON.stringify(body),
            headers: { "Content-Type": "application/json" },
            method: "POST",
        }
    )
        .then(async (response) => {
            const result = (await response.json().catch(() => null)) as GeneratedValueResponse | null
            if (!response.ok || result?.value === undefined) throw new Error(result?.error || "Could not generate field content.")
            return result
        })
        .finally(() => pendingRequests.delete(cacheKey))

    pendingRequests.set(cacheKey, request)
    return request
}

const GenerateField = ({ field, generationFieldKey, generationFieldType, path, readOnly }: GenerateFieldProps) => {
    const configContext = useConfig() as { config?: ClientConfig } | undefined
    const documentForm = useDocumentForm()
    const documentInfo = useDocumentInfo()
    const locale = useLocale()
    const { disabled, setValue } = useField<GeneratedRichTextValue | Record<string, unknown> | string | string[] | unknown[]>({ path })
    const [error, setError] = useState("")
    const [isGenerating, setIsGenerating] = useState(false)

    const scope = documentInfo.collectionSlug
        ? { slug: documentInfo.collectionSlug, type: "collection" as const }
        : documentInfo.globalSlug
          ? { slug: documentInfo.globalSlug, type: "global" as const }
          : null

    const generate = async () => {
        const apiRoute = configContext?.config?.routes?.api
        if (!apiRoute || !scope || isGenerating) return

        setError("")
        setIsGenerating(true)

        try {
            const context = documentForm.getData()
            const cacheKey = JSON.stringify([scope.type, scope.slug, generationFieldKey, locale.code, context])
            const result = await requestGeneratedValue({
                apiRoute,
                body: {
                    context,
                    fieldKey: generationFieldKey,
                    locale: locale.code,
                    scope,
                },
                cacheKey,
            })

            if (generationFieldType === "richText") {
                const value = createGeneratedRichTextValue(result.value as string)
                documentForm.dispatchFields({
                    initialValue: value,
                    path,
                    type: "UPDATE",
                    value,
                })
            } else {
                setValue(field?.hasMany ? [result.value as string] : result.value)
            }
            documentForm.setModified(true)
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not generate field content.")
        } finally {
            setIsGenerating(false)
        }
    }

    if (!scope) return null

    return (
        <div className={styles.generateField}>
            <button className={styles.generateButton} disabled={Boolean(readOnly || disabled || isGenerating)} onClick={() => void generate()} type="button">
                {isGenerating ? "Generating..." : "Generate"}
            </button>
            {error && (
                <span className={styles.generateError} role="alert">
                    {error}
                </span>
            )}
        </div>
    )
}

export default GenerateField

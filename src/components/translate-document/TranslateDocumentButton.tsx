"use client"

import { Button, useConfig, useDocumentForm, useDocumentInfo, useLocale } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import { useEffect, useState } from "react"

import styles from "./TranslateDocumentButton.module.css"

type ClientConfig = {
    routes?: {
        api?: string
    }
}

type TranslationResponse = {
    available?: boolean
    error?: string
    values?: Array<{
        fieldType: string
        path: string
        value: unknown
    }>
}

const TranslateDocumentButton = () => {
    const configContext = useConfig() as { config?: ClientConfig } | undefined
    const documentForm = useDocumentForm()
    const documentInfo = useDocumentInfo()
    const locale = useLocale()
    const [available, setAvailable] = useState(false)
    const [error, setError] = useState("")
    const [isChecking, setIsChecking] = useState(true)
    const [isTranslating, setIsTranslating] = useState(false)

    const scope = documentInfo.collectionSlug
        ? { slug: documentInfo.collectionSlug, type: "collection" as const }
        : documentInfo.globalSlug
          ? { slug: documentInfo.globalSlug, type: "global" as const }
          : null
    const apiRoute = configContext?.config?.routes?.api

    const request = async (action: "status" | "translate") => {
        if (!apiRoute || !scope) return null
        const response = await fetch(
            formatAdminURL({
                apiRoute,
                path: "/ai-translate-document",
            }),
            {
                body: JSON.stringify({
                    action,
                    id: documentInfo.id,
                    locale: locale.code,
                    scope,
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST",
            }
        )
        const result = (await response.json().catch(() => null)) as TranslationResponse | null
        if (!response.ok || !result) throw new Error(result?.error || "Could not translate this locale.")
        return result
    }

    useEffect(() => {
        let active = true
        setAvailable(false)
        setError("")
        setIsChecking(true)

        void request("status")
            .then((result) => {
                if (active) setAvailable(Boolean(result?.available))
            })
            .catch(() => {
                if (active) setAvailable(false)
            })
            .finally(() => {
                if (active) setIsChecking(false)
            })

        return () => {
            active = false
        }
    }, [apiRoute, documentInfo.id, locale.code, scope?.slug, scope?.type])

    const translate = async () => {
        if (isTranslating) return
        setError("")
        setIsTranslating(true)

        try {
            const result = await request("translate")
            for (const entry of result?.values || []) {
                documentForm.dispatchFields({
                    ...(entry.fieldType === "richText" ? { initialValue: entry.value } : {}),
                    path: entry.path,
                    type: "UPDATE",
                    value: entry.value,
                })
            }
            documentForm.setModified(true)
            setAvailable(false)
        } catch (translationError) {
            setError(translationError instanceof Error ? translationError.message : "Could not translate this locale.")
        } finally {
            setIsTranslating(false)
        }
    }

    if (isChecking || !available) return null

    return (
        <div className={styles.wrapper}>
            {error && (
                <span className={styles.error} role="alert">
                    {error}
                </span>
            )}
            <Button buttonStyle="subtle" disabled={isTranslating} margin={false} onClick={() => void translate()} size="medium">
                {isTranslating ? "Translating..." : "Translate"}
            </Button>
        </div>
    )
}

export default TranslateDocumentButton

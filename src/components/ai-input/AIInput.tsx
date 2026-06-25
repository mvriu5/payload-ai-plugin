"use client"

import { Button, PlusIcon, useConfig } from "@payloadcms/ui"
import { formatAdminURL } from "payload/shared"
import { type ChangeEvent, useEffect, useRef, useState } from "react"
import { type AIProvider } from "../../ai/providerOptions.js"
import { ActionToast, type ActionProposal } from "../action-toast/ActionToast.js"
import { type AppliedChange } from "../audit-log-list/AuditLogList.js"
import { type MediaAttachment, useAIChatStream } from "../hooks/useAIChatStream.js"
import { useAISettings } from "../hooks/useAISettings.js"
import { useAuditLog } from "../hooks/useAuditLog.js"
import { getTextBeforeCaret, useMentions } from "../hooks/useMentions.js"
import { usePluginConfig } from "../hooks/usePluginConfig.js"
import { ClaudeIcon, GoogleGeminiIcon, MistralAiIcon, OpenaiIcon, OpenrouterIcon } from "../Icons.js"
import { MentionPopover } from "../mention-popover/MentionPopover.js"
import styles from "./AIInput.module.css"

const getProviderIcon = (provider: AIProvider | null) => {
    const iconProps = {
        "aria-hidden": true,
        className: styles.selectProviderIcon,
    }

    switch (provider) {
        case "claude":
            return <ClaudeIcon {...iconProps} />
        case "google":
            return <GoogleGeminiIcon {...iconProps} />
        case "mistral":
            return <MistralAiIcon {...iconProps} />
        case "openai":
            return <OpenaiIcon {...iconProps} />
        case "openrouter":
            return <OpenrouterIcon {...iconProps} />
        default:
            return null
    }
}

const getFileSignature = (file: File) => `${file.name}:${file.size}:${file.lastModified}:${file.type}`

const AIInput = () => {
    const editorRef = useRef<HTMLDivElement>(null)
    const fileInputRef = useRef<HTMLInputElement>(null)
    const [prompt, setPrompt] = useState("")
    const [isApplying, setIsApplying] = useState(false)
    const [isUploadingMedia, setIsUploadingMedia] = useState(false)
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const [mediaAttachments, setMediaAttachments] = useState<MediaAttachment[]>([])
    const selectedFilesRef = useRef<File[]>([])
    const mediaAttachmentsRef = useRef<MediaAttachment[]>([])
    const uploadedFileSignaturesRef = useRef<Set<string>>(new Set())

    const { config } = useConfig()
    const { aiModelConfig, isCollectionMentionEnabled, locales, defaultLocale, media } = usePluginConfig(config)
    const acceptedMimeTypes = media?.acceptedMimeTypes?.join(",")
    const mediaEnabled = Boolean(media?.enabled)
    const { loadRecentChanges, prependChange } = useAuditLog({
        adminRoute: config.routes.admin,
        apiRoute: config.routes.api,
    })
    const { selectedModel, setSelectedModel, settingsProvider } = useAISettings({
        adminUserSlug: config.admin?.user,
        apiRoute: config.routes.api,
        defaultModels: aiModelConfig.defaults,
    })
    const { clearMentions, insertMention, mentionPopoverPosition, mentionRange, mentionSuggestions, mentionsRef, updateMentionState } = useMentions({
        apiRoute: config.routes.api,
        config,
        defaultLocale,
        editorRef,
        isCollectionMentionEnabled,
        locales,
        setPrompt,
        styles,
    })

    const updateSelectedFiles = (updater: File[] | ((currentFiles: File[]) => File[])) => {
        const nextFiles = typeof updater === "function" ? updater(selectedFilesRef.current) : updater
        selectedFilesRef.current = nextFiles
        setSelectedFiles(nextFiles)
    }

    const updateMediaAttachments = (updater: MediaAttachment[] | ((currentAttachments: MediaAttachment[]) => MediaAttachment[])) => {
        const nextAttachments = typeof updater === "function" ? updater(mediaAttachmentsRef.current) : updater
        mediaAttachmentsRef.current = nextAttachments
        setMediaAttachments(nextAttachments)
    }

    const clearInput = () => {
        setPrompt("")
        updateSelectedFiles([])
        updateMediaAttachments([])
        uploadedFileSignaturesRef.current = new Set()
        clearMentions()
        if (editorRef.current) editorRef.current.textContent = ""
    }

    const handleSelectFile = (event: ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || [])
        updateSelectedFiles((currentFiles) => {
            const selectedFileSignatures = new Set(currentFiles.map(getFileSignature))
            const nextFiles = [...currentFiles]

            for (const file of files) {
                const fileSignature = getFileSignature(file)

                if (selectedFileSignatures.has(fileSignature)) continue

                selectedFileSignatures.add(fileSignature)
                nextFiles.push(file)
            }

            return nextFiles
        })
        event.target.value = ""
    }

    const removeSelectedFile = (fileIndex: number) => {
        updateSelectedFiles((currentFiles) => currentFiles.filter((_, index) => index !== fileIndex))
    }

    const removeMediaAttachment = (attachmentIndex: number) => {
        updateMediaAttachments((currentAttachments) => currentAttachments.filter((_, index) => index !== attachmentIndex))
    }

    const { dismissChat, error, isLoading, proposals, resetChatState, response, setError, setProposals, setResponse, submit, tokenUsage } = useAIChatStream({
        apiRoute: config.routes.api,
        clearInput,
        mentionsRef,
        prompt,
        selectedModel,
    })

    const uploadSelectedFiles = async () => {
        const filesToUpload = selectedFilesRef.current

        if (filesToUpload.length === 0) return []

        const uploadedAttachments: MediaAttachment[] = []

        for (const file of filesToUpload) {
            const fileSignature = getFileSignature(file)

            if (uploadedFileSignaturesRef.current.has(fileSignature)) continue

            uploadedFileSignaturesRef.current.add(fileSignature)

            const formData = new FormData()
            formData.append("file", file)

            const res = await fetch(
                formatAdminURL({
                    apiRoute: config.routes.api,
                    path: "/ai-upload-media",
                }),
                {
                    body: formData,
                    method: "POST",
                }
            )
            const result = (await res.json().catch(() => null)) as { attachment?: MediaAttachment; error?: string } | null

            if (!res.ok || !result?.attachment) {
                uploadedFileSignaturesRef.current.delete(fileSignature)
                throw new Error(result?.error || `Could not upload ${file.name}`)
            }

            uploadedAttachments.push(result.attachment)
        }

        return uploadedAttachments
    }

    const handleSubmit = async () => {
        if (isUploadingMedia) return

        setError("")
        setIsUploadingMedia(true)

        try {
            const uploadedAttachments = await uploadSelectedFiles()
            const nextAttachments = [...mediaAttachmentsRef.current, ...uploadedAttachments]

            if (uploadedAttachments.length > 0) {
                updateMediaAttachments(nextAttachments)
                updateSelectedFiles([])
            }

            await submit({
                attachments: nextAttachments,
            })
        } catch (err) {
            setError(err instanceof Error ? err.message : "Media upload failed")
        } finally {
            setIsUploadingMedia(false)
        }
    }

    useEffect(() => {
        if (isLoading || error || proposals.length > 0 || !response) return

        const timeout = window.setTimeout(() => {
            setResponse("")
            clearInput()
        }, 10000)

        return () => window.clearTimeout(timeout)
    }, [error, isLoading, proposals.length, response])

    const getProposalViewURL = (proposal: ActionProposal) => {
        const adminRoute = config.routes.admin || "/admin"

        if (proposal.action === "updateGlobal" && proposal.slug) {
            return `${adminRoute}/globals/${proposal.slug}`
        }

        if (proposal.collection && proposal.id) {
            return `${adminRoute}/collections/${proposal.collection}/${proposal.id}`
        }

        return null
    }

    const handleApplyProposal = async (proposal: ActionProposal) => {
        setIsApplying(true)
        setError("")

        try {
            const res = await fetch(
                formatAdminURL({
                    apiRoute: config.routes.api,
                    path: "/ai-apply-action",
                }),
                {
                    body: JSON.stringify({
                        aiResponse: response,
                        prompt,
                        proposal,
                        tokenUsage,
                    }),
                    headers: { "Content-Type": "application/json" },
                    method: "POST",
                }
            )

            const result = (await res.json()) as {
                change?: AppliedChange | null
                doc?: {
                    id?: unknown
                }
                error?: string
            }
            if (!res.ok) {
                setProposals([])
                setResponse("")
                throw new Error(result.error || "Could not apply proposal")
            }

            resetChatState()
            if (result.change) {
                prependChange(result.change)
                window.dispatchEvent(new CustomEvent("payload-ai:audit-log-updated"))
            }
            void loadRecentChanges().catch(() => undefined)
            clearInput()
        } catch (err) {
            setError(err instanceof Error ? err.message : "Could not apply proposal")
        } finally {
            setIsApplying(false)
        }
    }

    return (
        <div className={styles.chatLayout}>
            <div className={styles.chat}>
                <div className={styles.chatHeader}>
                    <h2 className={styles.chatTitle}>AI Assistant</h2>
                </div>
                <div className={styles.chatInputRow}>
                    <div className={styles.chatInputSurface}>
                        <div
                            id="ai-input"
                            className={styles.chatInput}
                            ref={editorRef}
                            role="textbox"
                            aria-label="AIInput"
                            data-placeholder="Ask AI..."
                            contentEditable={proposals.length === 0 && !isLoading && Boolean(settingsProvider)}
                            onInput={(event) => {
                                const value = (event.target as HTMLElement).innerText
                                setPrompt(value)
                                if (!value.trim()) clearMentions()
                                updateMentionState(getTextBeforeCaret(event.target as HTMLElement))
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "ArrowDown" && mentionRange && mentionSuggestions.length > 0) {
                                    const firstOption = editorRef.current?.querySelector<HTMLButtonElement>("button")
                                    if (firstOption) {
                                        event.preventDefault()
                                        firstOption.focus()
                                        return
                                    }
                                }
                                if (event.key === "Enter" && !event.shiftKey) {
                                    event.preventDefault()
                                    void handleSubmit()
                                }
                            }}
                        />
                        {(selectedFiles.length > 0 || mediaAttachments.length > 0) && (
                            <div className={styles.attachmentTray} aria-label="Attached media">
                                {selectedFiles.map((file, index) => (
                                    <span className={styles.attachmentPill} key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
                                        <span className={styles.attachmentName} title={file.name}>
                                            {file.name}
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.attachmentRemove}
                                            disabled={isUploadingMedia}
                                            onClick={() => removeSelectedFile(index)}
                                            aria-label={`Remove ${file.name}`}
                                        >
                                            X
                                        </button>
                                    </span>
                                ))}
                                {mediaAttachments.map((attachment, index) => (
                                    <span className={styles.attachmentPill} key={`${attachment.collection}-${attachment.id}`}>
                                        <span className={styles.attachmentName} title={attachment.filename}>
                                            {attachment.filename}
                                        </span>
                                        <button
                                            type="button"
                                            className={styles.attachmentRemove}
                                            disabled={isUploadingMedia}
                                            onClick={() => removeMediaAttachment(index)}
                                            aria-label={`Remove ${attachment.filename}`}
                                        >
                                            X
                                        </button>
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                    {mentionRange && (
                        <MentionPopover
                            onSelect={insertMention}
                            style={
                                mentionPopoverPosition
                                    ? {
                                          left: `${mentionPopoverPosition.left}px`,
                                          top: `${mentionPopoverPosition.top}px`,
                                      }
                                    : undefined
                            }
                            suggestions={mentionSuggestions}
                        />
                    )}
                </div>
                <div className={styles.chatActionsRow}>
                    <div className={styles.settings}>
                        <label className={styles.setting}>
                            <span className={styles.settingLabel}>Model</span>
                            <div className={styles.selectWrapper}>
                                {settingsProvider && getProviderIcon(settingsProvider)}
                                <select
                                    className={styles.select}
                                    style={{ paddingLeft: settingsProvider ? "34px" : "12px" }}
                                    disabled={!settingsProvider}
                                    onChange={(event) => setSelectedModel(event.target.value)}
                                    value={selectedModel}
                                >
                                    {!settingsProvider && <option value="">No provider selected</option>}
                                    {settingsProvider &&
                                        aiModelConfig.providers[settingsProvider].map((model) => (
                                            <option key={model.value} value={model.value}>
                                                {model.label}
                                            </option>
                                        ))}
                                </select>
                            </div>
                        </label>
                    </div>
                    <div className={styles.actions}>
                        {mediaEnabled && (
                            <>
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    accept={acceptedMimeTypes}
                                    className={styles.fileInput}
                                    multiple
                                    onChange={handleSelectFile}
                                />
                                <Button
                                    buttonStyle="tab"
                                    aria-label="Attach media"
                                    margin={false}
                                    disabled={isLoading || isUploadingMedia || proposals.length > 0}
                                    onClick={() => fileInputRef.current?.click()}
                                >
                                    <PlusIcon />
                                </Button>
                            </>
                        )}
                        <Button
                            buttonStyle="primary"
                            aria-label="Send"
                            margin={false}
                            disabled={
                                !prompt.trim() ||
                                !settingsProvider ||
                                !selectedModel ||
                                isLoading ||
                                isUploadingMedia ||
                                Boolean(error) ||
                                Boolean(response) ||
                                proposals.length > 0
                            }
                            onClick={() => void handleSubmit()}
                        >
                            {isUploadingMedia || isLoading ? "Sending..." : "Send"}
                        </Button>
                    </div>
                </div>
                {(proposals.length > 0 || response) && (
                    <ActionToast
                        apiRoute={config.routes.api}
                        description={response}
                        error={error}
                        getViewURL={getProposalViewURL}
                        isApplying={isApplying}
                        onDismiss={() => dismissChat()}
                        onDismissError={() => setError("")}
                        onApply={(proposal, _index) => void handleApplyProposal(proposal)}
                        proposals={proposals}
                        prompt={prompt}
                        tokenUsage={tokenUsage}
                    />
                )}
            </div>
        </div>
    )
}

export default AIInput

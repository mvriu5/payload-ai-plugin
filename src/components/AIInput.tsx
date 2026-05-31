'use client'

import { useConfig } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { useEffect, useRef, useState } from 'react'

import {
  AIActionProposalList,
  type AIActionProposal,
} from './AIActionProposalList.js'
import styles from './AIInput.module.css'
import badgeStyles from './CollectionMentionBadge.module.css'
import {
  CollectionMentionPopover,
  type CollectionMentionOption,
} from './CollectionMentionPopover.js'

const getCollectionLabel = (label: unknown, fallback: string) => {
  if (typeof label === 'string') {
    return label
  }

  if (label && typeof label === 'object') {
    const firstLabel = Object.values(label)[0]

    if (typeof firstLabel === 'string') {
      return firstLabel
    }
  }

  return fallback
}

const isInternalCollection = (slug: string) => {
  return slug.startsWith('payload-') || slug === 'plugin-collection'
}

export const AIInput = () => {
  const { config } = useConfig()
  const editorRef = useRef<HTMLDivElement>(null)
  const [prompt, setPrompt] = useState('')
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionRange, setMentionRange] = useState<null | {
    end: number
    start: number
  }>(null)
  const [documentSuggestions, setDocumentSuggestions] = useState<
    CollectionMentionOption[]
  >([])
  const [appliedProposalIndexes, setAppliedProposalIndexes] = useState<number[]>(
    [],
  )
  const [debugInfo, setDebugInfo] = useState<null | Record<string, unknown>>(null)
  const [response, setResponse] = useState('')
  const [error, setError] = useState('')
  const [proposals, setProposals] = useState<AIActionProposal[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isApplying, setIsApplying] = useState(false)

  const collections: CollectionMentionOption[] = config.collections
    .filter((collection) => !isInternalCollection(collection.slug))
    .map((collection) => ({
      label: getCollectionLabel(collection.labels?.singular, collection.slug),
      slug: collection.slug,
      type: 'collection',
    }))

  const filteredCollections = collections.filter((collection) =>
    collection.slug.toLowerCase().includes(mentionQuery.toLowerCase()),
  )
  const mentionSuggestions =
    filteredCollections.length < 3
      ? [...filteredCollections, ...documentSuggestions]
      : filteredCollections

  useEffect(() => {
    const trimmedQuery = mentionQuery.trim()

    if (!mentionRange || !trimmedQuery || filteredCollections.length >= 3) {
      setDocumentSuggestions([])
      return
    }

    const abortController = new AbortController()

    const fetchDocumentSuggestions = async () => {
      const res = await fetch(
        formatAdminURL({
          apiRoute: config.routes.api,
          path: '/ai-mention-suggestions',
        }),
        {
          body: JSON.stringify({
            collectionMatches: filteredCollections.length,
            query: trimmedQuery,
          }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
          signal: abortController.signal,
        },
      )

      if (!res.ok) {
        setDocumentSuggestions([])
        return
      }

      const result = (await res.json()) as {
        suggestions?: CollectionMentionOption[]
      }

      setDocumentSuggestions(result.suggestions || [])
    }

    void fetchDocumentSuggestions()

    return () => abortController.abort()
  }, [
    config.routes.api,
    filteredCollections.length,
    mentionQuery,
    mentionRange,
  ])

  const getCaretOffset = (element: HTMLElement) => {
    const selection = window.getSelection()

    if (!selection || selection.rangeCount === 0) {
      return 0
    }

    const range = selection.getRangeAt(0)
    const clonedRange = range.cloneRange()

    clonedRange.selectNodeContents(element)
    clonedRange.setEnd(range.endContainer, range.endOffset)

    return clonedRange.toString().length
  }

  const moveCaretToEnd = (element: HTMLElement) => {
    const selection = window.getSelection()
    const range = document.createRange()

    range.selectNodeContents(element)
    range.collapse(false)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const updateMentionState = (value: string, caretPosition: number) => {
    const valueBeforeCaret = value.slice(0, caretPosition)
    const match = /(?:^|\s)@([\w-]*)$/.exec(valueBeforeCaret)

    if (!match || typeof match.index !== 'number') {
      setMentionQuery('')
      setMentionRange(null)
      return
    }

    const atIndex = valueBeforeCaret.lastIndexOf('@')

    setMentionQuery(match[1] || '')
    setMentionRange({
      end: caretPosition,
      start: atIndex,
    })
  }

  const insertMention = (suggestion: CollectionMentionOption) => {
    const editor = editorRef.current

    if (!mentionRange || !editor) {
      return
    }

    const beforeMention = prompt.slice(0, mentionRange.start)
    const afterMention = prompt.slice(mentionRange.end)
    const badgeText =
      suggestion.type === 'collection'
        ? `collection: ${suggestion.label}`
        : `document: ${suggestion.label}`
    const promptText =
      suggestion.type === 'collection'
        ? badgeText
        : `${badgeText} (${suggestion.collection}/${suggestion.id})`
    const badge = document.createElement('span')

    badge.className = `${badgeStyles.badge} ${styles.inlineBadge}`
    badge.contentEditable = 'false'
    badge.textContent = badgeText

    editor.textContent = beforeMention
    editor.append(badge, document.createTextNode(` ${afterMention}`))
    moveCaretToEnd(editor)

    setPrompt(`${beforeMention}${promptText} ${afterMention}`)
    setMentionQuery('')
    setMentionRange(null)
    setDocumentSuggestions([])
  }

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim()

    if (!trimmedPrompt) {
      return
    }

    setIsLoading(true)
    setError('')
    setResponse('')
    setProposals([])
    setAppliedProposalIndexes([])
    setDebugInfo(null)

    try {
      const res = await fetch(
        formatAdminURL({
          apiRoute: config.routes.api,
          path: '/ai-chat',
        }),
        {
          body: JSON.stringify({ prompt: trimmedPrompt }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      )

      const result = (await res.json()) as {
        debug?: Record<string, unknown>
        error?: string
        errorDetails?: Record<string, unknown>
        proposals?: AIActionProposal[]
        text?: string
      }

      setDebugInfo({
        ...(result.debug ? { debug: result.debug } : {}),
        ...(result.errorDetails ? { errorDetails: result.errorDetails } : {}),
      })

      if (!res.ok) {
        throw new Error(result.error || 'AI request failed')
      }

      setResponse(result.text || '')
      setProposals(result.proposals || [])
      setPrompt('')
      if (editorRef.current) {
        editorRef.current.textContent = ''
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI request failed')
    } finally {
      setIsLoading(false)
    }
  }

  const handleApplyProposal = async (
    proposal: AIActionProposal,
    index: number,
  ) => {
    setIsApplying(true)
    setError('')

    try {
      const res = await fetch(
        formatAdminURL({
          apiRoute: config.routes.api,
          path: '/ai-apply-action',
        }),
        {
          body: JSON.stringify({ proposal }),
          headers: {
            'Content-Type': 'application/json',
          },
          method: 'POST',
        },
      )

      const result = (await res.json()) as { error?: string }

      if (!res.ok) {
        throw new Error(result.error || 'Could not apply proposal')
      }

      setAppliedProposalIndexes((currentIndexes) => [
        ...currentIndexes,
        index,
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not apply proposal')
    } finally {
      setIsApplying(false)
    }
  }

  return (
    <div className={styles.chat}>
      <div className={styles.chatHeader}>
        <div>
          <h2 className={styles.chatTitle}>AI Assistant</h2>
          <p className={styles.chatDescription}>
            Ask AI to draft, improve, or analyze content.
          </p>
        </div>
      </div>
      <div className={styles.chatInputRow}>
        <div className={styles.chatInputSurface}>
          <div
            className={styles.chatInput}
            contentEditable
            data-placeholder="Ask AI..."
            onInput={(event) => {
              const value = event.currentTarget.innerText

              setPrompt(value)
              updateMentionState(value, getCaretOffset(event.currentTarget))
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void handleSubmit()
              }
            }}
            ref={editorRef}
            role="textbox"
            suppressContentEditableWarning
          />
        </div>
        {mentionRange ? (
          <CollectionMentionPopover
            onSelect={insertMention}
            suggestions={mentionSuggestions}
          />
        ) : null}
        <button
          className={styles.chatButton}
          disabled={!prompt.trim() || isLoading}
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isLoading ? 'Sending...' : 'Send'}
        </button>
      </div>
      {error ? <div className={styles.chatError}>{error}</div> : null}
      {debugInfo && Object.keys(debugInfo).length > 0 ? (
        <pre className={styles.debugInfo}>
          {JSON.stringify(debugInfo, null, 2)}
        </pre>
      ) : null}
      {response ? <div className={styles.chatResponse}>{response}</div> : null}
      <AIActionProposalList
        appliedProposalIndexes={appliedProposalIndexes}
        isApplying={isApplying}
        onApply={(proposal, index) => void handleApplyProposal(proposal, index)}
        proposals={proposals}
      />
    </div>
  )
}

"use client";

import { useConfig } from "@payloadcms/ui";
import { formatAdminURL } from "payload/shared";
import { useRef, useState } from "react";

import { aiProviderModels } from "../ai/providerOptions.js";
import {
  AIActionProposalList,
  type AIActionProposal,
} from "./AIActionProposalList.js";
import styles from "./AIInput.module.css";
import badgeStyles from "./CollectionMentionBadge.module.css";
import {
  CollectionMentionPopover,
  type CollectionMentionOption,
} from "./CollectionMentionPopover.js";
import { useAISettings } from "./hooks/useAISettings.js";
import { useDocumentMentionSuggestions } from "./hooks/useDocumentMentionSuggestions.js";

const getCollectionLabel = (label: unknown, fallback: string) => {
  if (typeof label === "string") return label;

  if (label && typeof label === "object") {
    const firstLabel = Object.values(label)[0];
    if (typeof firstLabel === "string") return firstLabel;
  }

  return fallback;
};

const isInternalCollection = (slug: string) => {
  return slug.startsWith("payload-") || slug === "plugin-collection";
};

type AIMention = {
  collection?: string;
  id?: string;
  label: string;
  parent?: string;
  slug: string;
  type: "block" | "collection" | "doc" | "global";
};

type FieldWithBlocks = {
  blocks?: {
    fields?: FieldWithBlocks[];
    labels?: {
      plural?: unknown;
      singular?: unknown;
    };
    slug: string;
  }[];
  fields?: FieldWithBlocks[];
  name?: string;
  type?: string;
};

const collectBlockOptions = ({
  fields,
  parent,
}: {
  fields: FieldWithBlocks[];
  parent: string;
}): CollectionMentionOption[] => {
  const options: CollectionMentionOption[] = [];

  for (const field of fields) {
    if (field.type === "blocks" && field.blocks) {
      for (const block of field.blocks) {
        options.push({
          label: getCollectionLabel(block.labels?.singular, block.slug),
          parent,
          slug: block.slug,
          type: "block",
        });

        options.push(
          ...collectBlockOptions({
            fields: block.fields || [],
            parent: `${parent}/${block.slug}`,
          }),
        );
      }
    }

    if (field.fields) {
      options.push(
        ...collectBlockOptions({
          fields: field.fields,
          parent,
        }),
      );
    }
  }

  return options;
};

export const AIInput = () => {
  const { config } = useConfig();
  const editorRef = useRef<HTMLDivElement>(null);
  const mentionPopoverRef = useRef<HTMLDivElement>(null);
  const [prompt, setPrompt] = useState("");
  const { selectedModel, setSelectedModel, settingsProvider } = useAISettings({
    adminUserSlug: config.admin?.user,
    apiRoute: config.routes.api,
  });
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionRange, setMentionRange] = useState<null | {
    end: number;
    start: number;
  }>(null);
  const [mentions, setMentions] = useState<AIMention[]>([]);
  const [appliedProposalIndexes, setAppliedProposalIndexes] = useState<
    number[]
  >([]);
  const [debugInfo, setDebugInfo] = useState<null | Record<string, unknown>>(
    null,
  );
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<AIActionProposal[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const collections: CollectionMentionOption[] = config.collections
    .filter((collection) => !isInternalCollection(collection.slug))
    .map((collection) => ({
      label: getCollectionLabel(collection.labels?.singular, collection.slug),
      slug: collection.slug,
      type: "collection",
    }));
  const globals: CollectionMentionOption[] =
    config.globals?.map((global) => ({
      label: getCollectionLabel(global.label, global.slug),
      slug: global.slug,
      type: "global",
    })) || [];
  const blocks: CollectionMentionOption[] = [
    ...config.collections.flatMap((collection) =>
      collectBlockOptions({
        fields: collection.fields as FieldWithBlocks[],
        parent: collection.slug,
      }),
    ),
    ...(config.globals?.flatMap((global) =>
      collectBlockOptions({
        fields: global.fields as FieldWithBlocks[],
        parent: global.slug,
      }),
    ) || []),
  ];
  const mentionOptions = [...collections, ...globals, ...blocks];

  const normalizedMentionQuery = mentionQuery.toLowerCase();
  const filteredCollections = collections.filter(
    (collection) =>
      collection.slug.toLowerCase().includes(normalizedMentionQuery) ||
      collection.label.toLowerCase().includes(normalizedMentionQuery),
  );
  const filteredMentionOptions = mentionOptions.filter((option) =>
    option.slug.toLowerCase().includes(normalizedMentionQuery),
  );
  const documentSuggestionCollection =
    filteredCollections.length === 1 ? filteredCollections[0]?.slug : null;
  const { documentSuggestions, resetDocumentSuggestions } =
    useDocumentMentionSuggestions({
      apiRoute: config.routes.api,
      documentSuggestionCollection,
      mentionQuery,
      mentionRange,
    });
  const mentionSuggestions = [
    ...filteredMentionOptions,
    ...documentSuggestions,
  ];

  const getCaretOffset = (element: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return 0;

    const range = selection.getRangeAt(0);
    const clonedRange = range.cloneRange();

    clonedRange.selectNodeContents(element);
    clonedRange.setEnd(range.endContainer, range.endOffset);

    return clonedRange.toString().length;
  };

  const moveCaretToEnd = (element: HTMLElement) => {
    const selection = window.getSelection();
    const range = document.createRange();

    range.selectNodeContents(element);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  const getTextNodeAtOffset = (element: HTMLElement, offset: number) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let currentOffset = 0;
    let node = walker.nextNode();

    while (node) {
      const nextOffset = currentOffset + (node.textContent?.length || 0);

      if (offset <= nextOffset) {
        return {
          node,
          offset: offset - currentOffset,
        };
      }

      currentOffset = nextOffset;
      node = walker.nextNode();
    }

    const textNode = document.createTextNode("");
    element.append(textNode);

    return {
      node: textNode,
      offset: 0,
    };
  };

  const replaceTextRangeWithBadge = ({
    badge,
    editor,
    end,
    start,
  }: {
    badge: HTMLSpanElement;
    editor: HTMLElement;
    end: number;
    start: number;
  }) => {
    const startPosition = getTextNodeAtOffset(editor, start);
    const endPosition = getTextNodeAtOffset(editor, end);
    const range = document.createRange();
    const trailingSpace = document.createTextNode(" ");

    range.setStart(startPosition.node, startPosition.offset);
    range.setEnd(endPosition.node, endPosition.offset);
    range.deleteContents();
    range.insertNode(trailingSpace);
    range.insertNode(badge);

    const selection = window.getSelection();
    const caretRange = document.createRange();

    caretRange.setStartAfter(trailingSpace);
    caretRange.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(caretRange);
  };

  const updateMentionState = (value: string, caretPosition: number) => {
    const valueBeforeCaret = value.slice(0, caretPosition);
    const match = /(?:^|\s)@([\w-]*)$/.exec(valueBeforeCaret);

    if (!match || typeof match.index !== "number") {
      setMentionQuery("");
      setMentionRange(null);
      return;
    }

    const atIndex = valueBeforeCaret.lastIndexOf("@");

    setMentionQuery(match[1] || "");
    setMentionRange({ end: caretPosition, start: atIndex });
  };

  const clearInput = () => {
    setPrompt("");
    setMentions([]);
    if (editorRef.current) editorRef.current.textContent = "";
  };

  const getProposalViewURL = (proposal: AIActionProposal) => {
    const adminRoute = config.routes.admin || "/admin";

    if (proposal.action === "updateGlobal" && proposal.slug) {
      return `${adminRoute}/globals/${proposal.slug}`;
    }

    if (proposal.collection && proposal.id) {
      return `${adminRoute}/collections/${proposal.collection}/${proposal.id}`;
    }

    return null;
  };

  const insertMention = (suggestion: CollectionMentionOption) => {
    const editor = editorRef.current;
    if (!mentionRange || !editor) return;

    const beforeMention = prompt.slice(0, mentionRange.start);
    const afterMention = prompt.slice(mentionRange.end);
    const badgeType = suggestion.type === "doc" ? "document" : suggestion.type;
    const badgePrefix = `${badgeType}:`;
    const badgeText = `${badgePrefix} ${suggestion.label}`;
    const promptText =
      suggestion.type === "doc"
        ? `${badgeText} (${suggestion.collection}/${suggestion.id})`
        : badgeText;
    const badge = document.createElement("span");

    badge.className = [
      badgeStyles.badge,
      badgeStyles[suggestion.type],
      styles.inlineBadge,
    ].join(" ");
    badge.contentEditable = "false";
    badge.append(
      Object.assign(document.createElement("span"), {
        className: badgeStyles.prefix,
        textContent: `${badgePrefix} `,
      }),
      Object.assign(document.createElement("span"), {
        className: badgeStyles.name,
        textContent: suggestion.label,
      }),
    );

    replaceTextRangeWithBadge({
      badge,
      editor,
      end: mentionRange.end,
      start: mentionRange.start,
    });
    editor.focus();

    setPrompt(`${beforeMention}${promptText} ${afterMention}`);
    setMentions((currentMentions) => {
      const mentionExists = currentMentions.some(
        (mention) =>
          mention.type === suggestion.type &&
          mention.slug === suggestion.slug &&
          mention.parent === suggestion.parent &&
          mention.collection === suggestion.collection &&
          mention.id === suggestion.id,
      );

      if (mentionExists) return currentMentions;

      return [...currentMentions, suggestion];
    });
    setMentionQuery("");
    setMentionRange(null);
    resetDocumentSuggestions();
  };

  const handleSubmit = async () => {
    const trimmedPrompt = prompt.trim();
    if (!trimmedPrompt) return;

    setIsLoading(true);
    setAppliedProposalIndexes([]);

    try {
      const res = await fetch(
        formatAdminURL({
          apiRoute: config.routes.api,
          path: "/ai-chat",
        }),
        {
          body: JSON.stringify({
            mentions,
            model: selectedModel,
            prompt: trimmedPrompt,
          }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );

      const result = (await res.json()) as {
        debug?: Record<string, unknown>;
        error?: string;
        errorDetails?: Record<string, unknown>;
        proposals?: AIActionProposal[];
        text?: string;
      };

      if (!res.ok) {
        setDebugInfo({
          ...(result.debug ? { debug: result.debug } : {}),
          ...(result.errorDetails ? { errorDetails: result.errorDetails } : {}),
        });
        setProposals([]);
        setResponse("");
        throw new Error(result.error || "AI request failed");
      }

      setDebugInfo(null);
      setError("");
      setResponse(result.text || "");
      setProposals(result.proposals || []);
    } catch (err) {
      setProposals([]);
      setResponse("");
      setError(err instanceof Error ? err.message : "AI request failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyProposal = async (proposal: AIActionProposal) => {
    setIsApplying(true);
    setError("");

    try {
      const res = await fetch(
        formatAdminURL({
          apiRoute: config.routes.api,
          path: "/ai-apply-action",
        }),
        {
          body: JSON.stringify({ proposal }),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        },
      );

      const result = (await res.json()) as {
        error?: string;
        errorDetails?: Record<string, unknown>;
        normalized?: Record<string, unknown>;
        proposal?: AIActionProposal;
      };
      if (!res.ok) {
        setDebugInfo({
          ...(result.errorDetails ? { errorDetails: result.errorDetails } : {}),
          ...(result.normalized ? { normalized: result.normalized } : {}),
          ...(result.proposal ? { proposal: result.proposal } : {}),
        });
        setProposals([]);
        setResponse("");
        throw new Error(result.error || "Could not apply proposal");
      }

      setAppliedProposalIndexes([]);
      setDebugInfo(null);
      setError("");
      setProposals([]);
      setResponse("");
      clearInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply proposal");
    } finally {
      setIsApplying(false);
    }
  };

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
              const value = event.currentTarget.innerText;

              setPrompt(value);
              if (!value.trim()) {
                setMentions([]);
              }
              updateMentionState(value, getCaretOffset(event.currentTarget));
            }}
            onKeyDown={(event) => {
              if (
                event.key === "ArrowDown" &&
                mentionRange &&
                mentionSuggestions.length > 0
              ) {
                const firstOption =
                  mentionPopoverRef.current?.querySelector<HTMLButtonElement>(
                    "button",
                  );
                if (firstOption) {
                  event.preventDefault();
                  firstOption.focus();
                  return;
                }
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                void handleSubmit();
              }
            }}
            ref={editorRef}
            role="textbox"
            suppressContentEditableWarning
          />
        </div>
        {mentionRange ? (
          <CollectionMentionPopover
            containerRef={mentionPopoverRef}
            onSelect={insertMention}
            suggestions={mentionSuggestions}
          />
        ) : null}
      </div>
      <div className={styles.chatActionsRow}>
        <div className={styles.settings}>
          <label className={styles.setting}>
            <span className={styles.settingLabel}>Model</span>
            <select
              className={styles.select}
              disabled={!settingsProvider}
              onChange={(event) => setSelectedModel(event.target.value)}
              value={selectedModel}
            >
              {!settingsProvider ? (
                <option value="">Select provider in account settings</option>
              ) : null}
              {settingsProvider
                ? aiProviderModels[settingsProvider].map((model) => (
                    <option key={model.value} value={model.value}>
                      {model.label}
                    </option>
                  ))
                : null}
            </select>
          </label>
        </div>
        <button
          className={styles.chatButton}
          disabled={
            !prompt.trim() || !settingsProvider || !selectedModel || isLoading
          }
          onClick={() => void handleSubmit()}
          type="button"
        >
          {isLoading ? "Sending..." : "Send"}
        </button>
      </div>
      <AIActionProposalList
        appliedProposalIndexes={appliedProposalIndexes}
        description={response}
        error={error}
        errorDetails={debugInfo}
        getViewURL={getProposalViewURL}
        isApplying={isApplying}
        onDismiss={() => {
          setAppliedProposalIndexes([]);
          setDebugInfo(null);
          setError("");
          setProposals([]);
          setResponse("");
          clearInput();
        }}
        onDismissError={() => {
          setError("");
          setDebugInfo(null);
        }}
        onApply={(proposal, _index) => void handleApplyProposal(proposal)}
        proposals={proposals}
      />
    </div>
  );
};

import { MentionOption } from "../../src/components/mention-popover/MentionPopover"

export const postJupiter = {
    id: "4",
    slug: "jupiter",
    title: "Jupiter",
}

export const postMars = {
    id: "5",
    slug: "mars",
    title: "Mars",
}

export const localizedPostJupiter = {
    id: "4",
    slug: "jupiter",
    title: {
        de: "Jupiter",
        en: "Jupiter",
    },
}

export const oldPostJupiter = {
    id: "4",
    slug: "jupiter",
    title: "Old Jupiter",
}

export const sensitivePostJupiter = {
    apiKey: "secret",
    id: "4",
    slug: "jupiter",
    title: "Old Jupiter",
}

export const auditLogEntryJupiter = {
    action: "update",
    additions: 3,
    after: postJupiter,
    before: oldPostJupiter,
    collection: "posts",
    createdAt: "2026-01-01T00:00:00.000Z",
    documentID: "4",
    inputTokens: 20,
    outputTokens: 10,
    prompt: "Update Jupiter",
    removals: 1,
    targetType: "collection",
    targetURL: "/admin/collections/posts/4",
    title: "Updated Jupiter",
    totalTokens: 30,
    userID: "user-1",
    userLabel: "Ada",
}

export const appliedChangeJupiter = {
    action: auditLogEntryJupiter.action,
    additions: auditLogEntryJupiter.additions,
    after: auditLogEntryJupiter.after,
    before: auditLogEntryJupiter.before,
    collection: auditLogEntryJupiter.collection,
    createdAt: auditLogEntryJupiter.createdAt,
    documentID: auditLogEntryJupiter.documentID,
    inputTokens: auditLogEntryJupiter.inputTokens,
    outputTokens: auditLogEntryJupiter.outputTokens,
    removals: auditLogEntryJupiter.removals,
    targetType: auditLogEntryJupiter.targetType,
    title: auditLogEntryJupiter.title,
    totalTokens: auditLogEntryJupiter.totalTokens,
    url: auditLogEntryJupiter.targetURL,
    userID: auditLogEntryJupiter.userID,
    userLabel: auditLogEntryJupiter.userLabel,
}

export const createAppliedChangeJupiter = (index: number) => ({
    ...appliedChangeJupiter,
    additions: index,
    documentID: String(index),
    removals: index + 1,
    title: `Jupiter change ${index}`,
    url: `/admin/collections/posts/${index}`,
})

export const mentionOptionPosts = {
    label: "Posts",
    slug: "posts",
    type: "collection" as const,
}

export const mentionOptionJupiter = {
    collection: "posts",
    id: postJupiter.id,
    label: postJupiter.title,
    slug: "posts:4",
    type: "doc" as const,
}

export const mentionOptionMars = {
    collection: "posts",
    id: postMars.id,
    label: postMars.title,
    slug: "posts:5",
    type: "doc" as const,
}

export const mentionOptionSiteSettings = {
    label: "Site Settings",
    slug: "site-settings",
    type: "global" as const,
}

export const mentionOptions = [
    mentionOptionPosts,
    mentionOptionJupiter,
    mentionOptionSiteSettings,
    {
        isDefault: true,
        label: "English",
        slug: "en",
        type: "locale" as const,
    },
] as MentionOption[]

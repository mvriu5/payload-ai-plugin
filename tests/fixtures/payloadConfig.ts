export const postsCollection = {
    admin: {
        useAsTitle: "title",
    },
    fields: [
        {
            localized: true,
            name: "title",
            required: true,
            type: "text",
        },
        {
            name: "slug",
            type: "text",
        },
        {
            name: "apiKey",
            type: "text",
        },
    ],
    labels: {
        singular: "Post",
    },
    slug: "posts",
}

export const usersCollection = {
    fields: [{ name: "email", type: "email" }],
    slug: "users",
}

export const mediaCollection = {
    fields: [
        {
            name: "alt",
            type: "text",
        },
        {
            name: "caption",
            type: "textarea",
        },
    ],
    slug: "media",
    upload: true,
}

export const siteSettingsGlobal = {
    fields: [
        {
            localized: true,
            name: "siteName",
            type: "text",
        },
    ],
    slug: "site-settings",
}

export const localizedConfig = {
    defaultLocale: "en",
    localeCodes: ["en", "de"],
    locales: [
        {
            code: "en",
            label: "English",
        },
        {
            code: "de",
            label: "Deutsch",
        },
    ],
}

export const adminConfig = {
    admin: {
        custom: {
            payloadAiPlugin: {
                collectionSlugs: ["posts"],
            },
        },
        user: "users",
    },
    collections: [postsCollection],
    globals: [],
    routes: {
        admin: "/admin",
        api: "/api",
    },
}

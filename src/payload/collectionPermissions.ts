import type { PayloadHandler } from "payload"

import { isInternalCollection } from "./shared.js"

export type CollectionAction = "create" | "delete" | "read" | "update"

type CollectionPermissions = Partial<Record<CollectionAction, boolean>>

type CollectionPermissionConfig = true | CollectionPermissions

export type CollectionPermissionMap = Partial<Record<string, CollectionPermissionConfig>>

export type ResolvedCollectionPermissionMap = Partial<Record<string, Record<CollectionAction, boolean>>>

const allActions: CollectionAction[] = ["create", "delete", "read", "update"]

const getKnownCollectionSlugs = (req: Parameters<PayloadHandler>[0]) => {
    return req.payload.config.collections.flatMap((collection) => (isInternalCollection(collection.slug) ? [] : [collection.slug]))
}

export const resolveCollectionPermissions = (collections?: CollectionPermissionMap): ResolvedCollectionPermissionMap | undefined => {
    if (!collections) return undefined

    const entries = Object.entries(collections).map(([slug, config]) => {
        if (config === true) {
            return [
                slug,
                {
                    create: true,
                    delete: true,
                    read: true,
                    update: true,
                },
            ]
        }

        if (!config) {
            return [
                slug,
                {
                    create: false,
                    delete: false,
                    read: false,
                    update: false,
                },
            ]
        }

        return [
            slug,
            {
                create: Boolean(config.create),
                delete: Boolean(config.delete),
                read: Boolean(config.read),
                update: Boolean(config.update),
            },
        ]
    })

    return Object.fromEntries(entries)
}

export const getCollectionSlugsForAction = ({
    action,
    permissions,
    req,
}: {
    action: CollectionAction
    permissions?: ResolvedCollectionPermissionMap
    req: Parameters<PayloadHandler>[0]
}) => {
    const knownSlugs = getKnownCollectionSlugs(req)

    if (!permissions) return knownSlugs

    return knownSlugs.filter((slug) => Boolean(permissions[slug]?.[action]))
}

export const isCollectionActionAllowed = ({
    action,
    permissions,
    req,
    slug,
}: {
    action: CollectionAction
    permissions?: ResolvedCollectionPermissionMap
    req: Parameters<PayloadHandler>[0]
    slug: string
}) => {
    if (!getKnownCollectionSlugs(req).includes(slug)) return false
    if (!permissions) return true

    return Boolean(permissions[slug]?.[action])
}

export const getCollectionPermissions = ({ permissions, slug }: { permissions?: ResolvedCollectionPermissionMap; slug: string }) => {
    if (!permissions) {
        return Object.fromEntries(allActions.map((action) => [action, true])) as Record<CollectionAction, boolean>
    }

    return permissions[slug] || (Object.fromEntries(allActions.map((action) => [action, false])) as Record<CollectionAction, boolean>)
}

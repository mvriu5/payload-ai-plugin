import { describe, expect, it } from "vitest"

import {
    getCollectionPermissions,
    getCollectionSlugsForAction,
    isCollectionActionAllowed,
    resolveCollectionPermissions,
} from "../../../src/payload/collectionPermissions.js"
import { createMockRequest } from "../../fixtures/handler.js"

describe("collectionPermissions", () => {
    it("returns undefined when no collection config is provided", () => {
        expect(resolveCollectionPermissions()).toBeUndefined()
    })

    it("expands `true` into full collection permissions", () => {
        expect(
            resolveCollectionPermissions({
                posts: true,
            })
        ).toEqual({
            posts: {
                create: true,
                delete: true,
                read: true,
                update: true,
            },
        })
    })

    it("resolves granular permissions per collection", () => {
        expect(
            resolveCollectionPermissions({
                posts: {
                    read: true,
                    update: true,
                },
                users: {
                    create: true,
                },
            })
        ).toEqual({
            posts: {
                create: false,
                delete: false,
                read: true,
                update: true,
            },
            users: {
                create: true,
                delete: false,
                read: false,
                update: false,
            },
        })
    })

    it("filters known collection slugs by action", () => {
        const permissions = resolveCollectionPermissions({
            posts: true,
            users: {
                read: true,
            },
        })
        const req = createMockRequest({
            collections: [{ slug: "posts" }, { slug: "users" }, { slug: "payload-ai-auditlog" }],
        })

        expect(
            getCollectionSlugsForAction({
                action: "read",
                permissions,
                req,
            })
        ).toEqual(["posts", "users"])
        expect(
            getCollectionSlugsForAction({
                action: "update",
                permissions,
                req,
            })
        ).toEqual(["posts"])
    })

    it("checks whether a collection action is allowed", () => {
        const permissions = resolveCollectionPermissions({
            posts: {
                read: true,
            },
        })
        const req = createMockRequest({
            collections: [{ slug: "posts" }, { slug: "users" }],
        })

        expect(
            isCollectionActionAllowed({
                action: "read",
                permissions,
                req,
                slug: "posts",
            })
        ).toBe(true)
        expect(
            isCollectionActionAllowed({
                action: "update",
                permissions,
                req,
                slug: "posts",
            })
        ).toBe(false)
        expect(
            isCollectionActionAllowed({
                action: "read",
                permissions,
                req,
                slug: "missing",
            })
        ).toBe(false)
    })

    it("returns permissive defaults without explicit permissions and restrictive defaults for unknown slugs", () => {
        expect(getCollectionPermissions({ slug: "posts" })).toEqual({
            create: true,
            delete: true,
            read: true,
            update: true,
        })

        expect(
            getCollectionPermissions({
                permissions: {
                    posts: {
                        create: false,
                        delete: false,
                        read: true,
                        update: false,
                    },
                },
                slug: "users",
            })
        ).toEqual({
            create: false,
            delete: false,
            read: false,
            update: false,
        })
    })
})

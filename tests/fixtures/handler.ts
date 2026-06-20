import { vi } from "vitest"

type MockPayloadOptions = {
    collections?: unknown[]
    create?: ReturnType<typeof vi.fn>
    delete?: ReturnType<typeof vi.fn>
    find?: ReturnType<typeof vi.fn>
    findByID?: ReturnType<typeof vi.fn>
    findGlobal?: ReturnType<typeof vi.fn>
    globals?: unknown[]
    localization?: unknown
    update?: ReturnType<typeof vi.fn>
    updateGlobal?: ReturnType<typeof vi.fn>
}

type MockRequestOptions = MockPayloadOptions & {
    body?: unknown
    user?: unknown
}

export const readJSON = async <Value = unknown>(response: Response) => {
    return (await response.json()) as Value
}

export const createMockRequest = ({
    body,
    collections = [],
    create,
    delete: deleteOperation,
    find,
    findByID,
    findGlobal,
    globals = [],
    localization = false,
    update,
    updateGlobal,
    user = { id: "user-1" },
}: MockRequestOptions = {}) =>
    ({
        json: body === undefined ? undefined : vi.fn().mockResolvedValue(body),
        payload: {
            config: {
                collections,
                globals,
                localization,
                routes: {
                    admin: "/admin",
                },
            },
            create: create || vi.fn(),
            delete: deleteOperation || vi.fn(),
            find: find || vi.fn(),
            findByID: findByID || vi.fn(),
            findGlobal: findGlobal || vi.fn(),
            logger: {
                error: vi.fn(),
            },
            update: update || vi.fn(),
            updateGlobal: updateGlobal || vi.fn(),
        },
        user,
    }) as never

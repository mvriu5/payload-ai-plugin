import { vi } from "vitest"

export const createJSONResponse = (value: unknown, ok = true) =>
    ({
        json: vi.fn().mockResolvedValue(value),
        ok,
    }) as Response

export const createStreamResponse = (body: string) =>
    ({
        body: new Response(body).body,
        ok: true,
    }) as Response

export const installFetchMock = (mock = vi.fn()) => {
    globalThis.fetch = mock as never

    return mock
}

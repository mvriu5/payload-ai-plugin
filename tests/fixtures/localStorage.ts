import { vi } from "vitest"

export const installLocalStorageMock = () => {
    const store = new Map<string, string>()

    Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
            clear: vi.fn(() => store.clear()),
            getItem: vi.fn((key: string) => store.get(key) ?? null),
            removeItem: vi.fn((key: string) => store.delete(key)),
            setItem: vi.fn((key: string, value: string) => store.set(key, value)),
        },
    })
}

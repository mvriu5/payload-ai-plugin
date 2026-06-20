import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

type RenderResult = {
    container: HTMLDivElement
    rerender: (element: React.ReactNode) => void
    unmount: () => void
}

const roots = new Set<{
    container: HTMLDivElement
    root: Root
}>()

export const render = (element: React.ReactNode): RenderResult => {
    const container = document.createElement("div")
    const root = createRoot(container)
    const rootEntry = { container, root }

    document.body.append(container)
    roots.add(rootEntry)

    act(() => {
        root.render(element)
    })

    return {
        container,
        rerender: (nextElement) => {
            act(() => {
                root.render(nextElement)
            })
        },
        unmount: () => {
            act(() => {
                root.unmount()
            })
            roots.delete(rootEntry)
            container.remove()
        },
    }
}

export const cleanupRoots = () => {
    for (const { container, root } of roots) {
        act(() => {
            root.unmount()
        })
        container.remove()
    }

    roots.clear()
    document.body.innerHTML = ""
}

"use client"

import React, { useMemo } from "react"
import styles from "./TextShimmer.module.css"

export type TextShimmerProps = {
    children: string
    as?: React.ElementType
    className?: string
    duration?: number
    spread?: number
}

export function TextShimmer({ children, as: Component = "p", className, duration = 1, spread = 2 }: TextShimmerProps) {
    const dynamicSpread = useMemo(() => {
        return children.length * spread
    }, [children, spread])

    return (
        <Component
            className={`${className ?? ""} ${styles.textShimmer}`}
            style={{
                position: "relative",
                display: "inline-block",
                backgroundImage: `
      linear-gradient(
        90deg,
        transparent calc(50% - ${dynamicSpread}px),
        var(--shimmer-color, #000),
        transparent calc(50% + ${dynamicSpread}px)
      ),
      linear-gradient(var(--base-color, #a1a1aa), var(--base-color, #a1a1aa))
    `,
                backgroundSize: "250% 100%, auto",
                backgroundRepeat: "no-repeat",
                backgroundClip: "text",
                WebkitBackgroundClip: "text",
                color: "transparent",
            }}
        >
            {children}
        </Component>
    )
}

import type { FieldConfig } from "../schema/normalize.js"
import { isRecord } from "../../utils/data.js"
import type { ProposalValidationIssue } from "./normalizationTypes.js"

const normalizeRelationshipScalar = (value: number | string) => {
    if (typeof value === "number") {
        if (!Number.isInteger(value) || value <= 0) return undefined
        return value
    }

    const trimmedValue = value.trim()
    if (!trimmedValue || /\s/.test(trimmedValue)) return undefined
    if (/^\d+$/.test(trimmedValue)) {
        const numericValue = Number(trimmedValue)
        return numericValue > 0 ? numericValue : undefined
    }

    return trimmedValue
}

export const normalizeRelationshipValue = ({
    field,
    issues,
    path,
    value,
}: {
    field: FieldConfig
    issues: ProposalValidationIssue[]
    path: string
    value: unknown
}) => {
    const allowedRelationTargets = Array.isArray(field.relationTo)
        ? field.relationTo.filter((item): item is string => typeof item === "string")
        : typeof field.relationTo === "string"
          ? [field.relationTo]
          : []

    const addInvalidRelationship = (message: string, itemPath: string) => {
        issues.push({
            code: "invalid_relationship",
            message,
            path: itemPath,
        })
    }

    const normalizeSingle = (item: unknown, itemPath: string): unknown => {
        if (typeof item === "number" || typeof item === "string") {
            const normalizedValue = normalizeRelationshipScalar(item)
            if (normalizedValue !== undefined) return normalizedValue

            addInvalidRelationship(
                typeof item === "string"
                    ? "Relationship and upload fields must use a valid document ID, not free text."
                    : "Relationship and upload fields must use a valid document ID.",
                itemPath
            )
            return undefined
        }

        if (!isRecord(item)) {
            addInvalidRelationship("Relationship and upload fields must use a document ID or an object with id/value.", itemPath)
            return undefined
        }

        if (typeof item.id === "string" || typeof item.id === "number") {
            const normalizedValue = normalizeRelationshipScalar(item.id)
            if (normalizedValue !== undefined) return normalizedValue

            addInvalidRelationship("Relationship and upload fields must use a valid document ID.", itemPath)
            return undefined
        }

        if (typeof item.value === "string" || typeof item.value === "number") {
            const normalizedValue = normalizeRelationshipScalar(item.value)
            if (normalizedValue === undefined) {
                addInvalidRelationship("Relationship and upload fields must use a valid document ID.", itemPath)
                return undefined
            }

            if (allowedRelationTargets.length > 1) {
                const relationTo = typeof item.relationTo === "string" ? item.relationTo : null
                if (!relationTo || !allowedRelationTargets.includes(relationTo)) {
                    addInvalidRelationship(`Relationship must include one of: ${allowedRelationTargets.join(", ")}.`, itemPath)
                    return undefined
                }

                return { relationTo, value: normalizedValue }
            }

            return normalizedValue
        }

        addInvalidRelationship("Relationship and upload fields must use a document ID or an object with id/value.", itemPath)
        return undefined
    }

    if (!field.hasMany) return normalizeSingle(value, path)
    if (!Array.isArray(value)) {
        addInvalidRelationship("Relationship field expects an array of document IDs.", path)
        return undefined
    }

    return value.map((item, index) => normalizeSingle(item, `${path}.${index}`)).filter((item) => item !== undefined)
}

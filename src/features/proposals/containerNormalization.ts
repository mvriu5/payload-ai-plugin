import type { FieldConfig } from "../schema/normalize.js"
import { isRecord } from "../../utils/data.js"
import type { NormalizeFieldValueArgs } from "./normalizationTypes.js"

const normalizeGroup = ({ field, normalizeRecord, path, value, ...state }: NormalizeFieldValueArgs) => {
    if (!isRecord(value)) {
        state.issues.push({
            code: "invalid_container",
            message: "Group fields must be objects.",
            path,
        })
        return undefined
    }

    return normalizeRecord({
        ...state,
        allowSafeFallback: false,
        enforceRequiredChildren: state.mode === "create" || state.enforceRequiredChildren,
        fields: field.fields || [],
        path,
        value,
    })
}

const getArrayItemLabelField = (field: FieldConfig) => {
    const childFields = (field.fields || []).filter((childField): childField is FieldConfig & { name: string } => Boolean(childField.name))

    return (
        childFields.find((childField) => childField.name === "label") ||
        childFields.find((childField) => childField.name === "title") ||
        childFields.find((childField) => childField.name === "name") ||
        childFields.find((childField) => childField.name === "value") ||
        childFields[0]
    )
}

const normalizeArray = ({ field, normalizeRecord, path, value, ...state }: NormalizeFieldValueArgs) => {
    if (!Array.isArray(value)) {
        state.issues.push({
            code: "invalid_array",
            message: "Array fields must use an array value.",
            path,
        })
        return undefined
    }

    const itemLabelField = getArrayItemLabelField(field)

    return value.map((item, index) => {
        const itemPath = `${path}.${index}`
        if (!isRecord(item) && !itemLabelField) {
            state.issues.push({
                code: "invalid_array",
                message: "Array items must be objects for this field.",
                path: itemPath,
            })
            return undefined
        }

        return normalizeRecord({
            ...state,
            allowSafeFallback: false,
            enforceRequiredChildren: true,
            fields: field.fields || [],
            path: itemPath,
            value: isRecord(item) ? item : { [itemLabelField!.name]: item },
        })
    })
}

const getBlockType = (item: Record<string, unknown>) =>
    typeof item.blockType === "string" ? item.blockType : typeof item.type === "string" ? item.type : typeof item.slug === "string" ? item.slug : null

const normalizeBlocks = ({ field, normalizeRecord, path, value, ...state }: NormalizeFieldValueArgs) => {
    if (!Array.isArray(value)) {
        state.issues.push({
            code: "invalid_blocks",
            message: "Blocks fields must use an array value.",
            path,
        })
        return undefined
    }

    return value.map((item, index) => {
        const itemPath = `${path}.${index}`
        if (!isRecord(item)) {
            state.issues.push({
                code: "invalid_blocks",
                message: "Each block entry must be an object.",
                path: itemPath,
            })
            return undefined
        }

        const blockType = getBlockType(item)
        if (!blockType) {
            state.issues.push({
                code: "invalid_block_type",
                message: "Each block entry must include blockType.",
                path: itemPath,
            })
            return undefined
        }

        const block = field.blocks?.find((candidate) => candidate.slug === blockType)
        if (!block) {
            state.issues.push({
                code: "invalid_block_type",
                message: `Unknown block type "${blockType}".`,
                path: `${itemPath}.blockType`,
            })
            return undefined
        }

        const { blockType: _blockType, slug: _slug, type: _type, ...blockData } = item
        return {
            ...normalizeRecord({
                ...state,
                allowSafeFallback: false,
                enforceRequiredChildren: true,
                fields: block.fields || [],
                path: itemPath,
                value: blockData,
            }),
            blockType,
        }
    })
}

export const containerNormalizers = {
    array: normalizeArray,
    blocks: normalizeBlocks,
    group: normalizeGroup,
} satisfies Partial<Record<string, (args: NormalizeFieldValueArgs) => unknown>>

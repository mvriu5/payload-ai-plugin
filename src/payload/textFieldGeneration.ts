import type { CustomComponent, Field } from "payload"

type GeneratableField = Extract<Field, { type: "json" | "richText" | "text" | "textarea" }>

export type TextGenerationFieldContext = {
    description?: string
    fieldType: GeneratableField["type"]
    hasMany: boolean
    key: string
    label: string
    maxLength?: number
    name: string
}

export type TextGenerationPageContext = {
    fields: TextGenerationFieldContext[]
    label: string
    slug: string
    type: "collection" | "global"
}

const generateFieldComponent = "@mvriu5/payload-ai/client#GenerateField"

const getLabel = (field: GeneratableField) => {
    if (typeof field.label === "string") return field.label
    if (field.label && typeof field.label === "object") {
        const label = Object.values(field.label).find((value) => typeof value === "string")
        if (typeof label === "string") return label
    }

    return field.name
}

const getDescription = (field: GeneratableField) => {
    const description = field.admin?.description
    return typeof description === "string" ? description : undefined
}

const addGenerateComponent = (field: GeneratableField, key: string) => {
    field.admin = field.admin || {}
    field.admin.components = field.admin.components || {}
    const current: CustomComponent[] = field.admin.components.afterInput || []
    const alreadyAdded = current.some((component) => {
        if (typeof component === "string") return component === generateFieldComponent
        return component && typeof component === "object" && "path" in component && component.path === generateFieldComponent
    })

    if (alreadyAdded) return

    field.admin.components.afterInput = [
        ...current,
        {
            clientProps: {
                generationFieldKey: key,
                generationFieldType: field.type,
            },
            path: generateFieldComponent,
        },
    ]
}

const visitFields = ({ fields, parentKey, result }: { fields: Field[]; parentKey: string; result: TextGenerationFieldContext[] }) => {
    for (const field of fields) {
        if (field.type === "tabs") {
            for (const tab of field.tabs) {
                visitFields({
                    fields: tab.fields,
                    parentKey: "name" in tab ? `${parentKey}.${tab.name}` : parentKey,
                    result,
                })
            }
            continue
        }

        if (field.type === "blocks") {
            for (const block of field.blocks) {
                if (typeof block !== "object") continue
                visitFields({
                    fields: block.fields,
                    parentKey: `${parentKey}.${field.name}.${block.slug}`,
                    result,
                })
            }
            continue
        }

        if ("fields" in field && Array.isArray(field.fields)) {
            const nextParent = "name" in field && field.name ? `${parentKey}.${field.name}` : parentKey
            visitFields({ fields: field.fields, parentKey: nextParent, result })
        }

        if (!["json", "richText", "text", "textarea"].includes(field.type) || !("name" in field) || !field.name) continue

        const key = `${parentKey}.${field.name}`
        const generatableField = field as GeneratableField
        if (generatableField.admin?.hidden) continue
        addGenerateComponent(generatableField, key)
        result.push({
            description: getDescription(generatableField),
            fieldType: generatableField.type,
            hasMany: "hasMany" in generatableField ? Boolean(generatableField.hasMany) : false,
            key,
            label: getLabel(generatableField),
            maxLength: "maxLength" in generatableField ? generatableField.maxLength : undefined,
            name: generatableField.name,
        })
    }
}

export const addTextGenerationFields = ({
    fields,
    label,
    slug,
    type,
}: {
    fields: Field[]
    label: string
    slug: string
    type: TextGenerationPageContext["type"]
}): TextGenerationPageContext => {
    const result: TextGenerationFieldContext[] = []
    visitFields({ fields, parentKey: slug, result })

    return {
        fields: result,
        label,
        slug,
        type,
    }
}

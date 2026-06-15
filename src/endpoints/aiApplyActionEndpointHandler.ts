import type { PayloadHandler } from "payload";

import type { AIActionProposal } from "./aiChatEndpointHandler.js";

type AIApplyActionBody = {
    proposal?: AIActionProposal;
};

type AIApplyActionEndpointOptions = {
    collections?: string[];
};

type FieldConfig = {
    blocks?: BlockConfig[];
    defaultValue?: unknown;
    fields?: FieldConfig[];
    name?: string;
    options?: (string | { value?: string })[];
    type?: string;
};

type BlockConfig = {
    fields?: FieldConfig[];
    slug: string;
};

type CollectionConfig = {
    auth?: unknown;
    fields: FieldConfig[];
    slug: string;
};

type NormalizedData = {
    coercedFields: string[];
    data: Record<string, unknown>;
    droppedFields: string[];
};

const SKIP_FIELD = Symbol("skipField");

const isKnownCollection = (req: Parameters<PayloadHandler>[0], collection: string) => {
    return req.payload.config.collections.some((item) => item.slug === collection);
};

const isAllowedCollection = (req: Parameters<PayloadHandler>[0], collection: string, collections?: string[]) => {
    if (!collections) return isKnownCollection(req, collection);

    return collections.includes(collection) && isKnownCollection(req, collection);
};

const isKnownGlobal = (req: Parameters<PayloadHandler>[0], slug: string) => {
    return (req.payload.config.globals?.some((item) => item.slug === slug) || false);
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const getNamedFields = (fields: FieldConfig[]) => {
    return fields.filter((field): field is FieldConfig & { name: string } => Boolean(field.name));
};

const isAuthCollection = (collectionConfig?: CollectionConfig | null) => {
    return Boolean(collectionConfig?.auth);
};

const getCollectionFields = (collectionConfig?: CollectionConfig | null) => {
    const fields = [...(collectionConfig?.fields || [])];

    if (isAuthCollection(collectionConfig)) {
        fields.push(
            {
                name: "email",
                type: "email",
            },
            {
                name: "password",
                type: "text",
            },
        );
    }

    return fields;
};

const createLexicalText = (value: unknown) => {
    if (isRecord(value) && isRecord(value.root)) return value;

    const text = Array.isArray(value) ? value.join("\n") : String(value || "");
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);

    return {
        root: {
            children: (lines.length ? lines : [""]).map((line) => ({
                children: [
                    {
                        detail: 0,
                        format: 0,
                        mode: "normal",
                        style: "",
                        text: line,
                        type: "text",
                        version: 1,
                    },
                ],
                direction: null,
                format: "",
                indent: 0,
                type: "paragraph",
                version: 1,
            })),
            direction: null,
            format: "",
            indent: 0,
            type: "root",
            version: 1,
        },
    };
};

const normalizeArrayValue = (field: FieldConfig, value: unknown) => {
    if (!Array.isArray(value)) return value;

    const childFields = getNamedFields(field.fields || []);
    const itemLabelField =
        childFields.find((childField) => childField.name === "label") ||
        childFields.find((childField) => childField.name === "title") ||
        childFields.find((childField) => childField.name === "name") ||
        childFields.find((childField) => childField.name === "value") ||
        childFields[0];

    if (!itemLabelField) return value;

    return value.map((item) => {
        if (!isRecord(item)) return { [itemLabelField.name]: item };
        return normalizeDataForFields(childFields, item).data;
    });
};

const getOptionValues = (field: FieldConfig) => {
    return (field.options || [])
        .map((option) => (typeof option === "string" ? option : option.value))
        .filter((option): option is string => Boolean(option));
};

const normalizeOptionValue = (field: FieldConfig, value: unknown) => {
    const optionValues = getOptionValues(field);
    const stringValue = value === null ? "" : String(value);
    const defaultValue = typeof field.defaultValue === "string" ? field.defaultValue : null;

    if (stringValue && optionValues.includes(stringValue)) return stringValue;
    if (defaultValue && optionValues.includes(defaultValue)) return defaultValue;
    return SKIP_FIELD;
};

const normalizeBlocksValue = (field: FieldConfig, value: unknown) => {
    if (!Array.isArray(value)) return value;

    return value.map((item) => {
        if (!isRecord(item)) return null;

        const blockType = typeof item.blockType === "string"
            ? item.blockType
            : typeof item.type === "string"
                ? item.type
                : typeof item.slug === "string"
                    ? item.slug
                    : null;

        if (!blockType) return null;

        const block = field.blocks?.find((candidate) => candidate.slug === blockType);
        if (!block) return null;

        const { blockType: _blockType, type: _type, slug: _slug, ...data } = item;
        const normalizedBlock = normalizeDataForFields(block.fields || [], data).data;

        return { ...normalizedBlock, blockType };
    }).filter(Boolean);
};

const normalizeFieldValue = (field: FieldConfig, value: unknown): typeof SKIP_FIELD | unknown => {
    if (value === undefined) return value;

    if (field.type === "array") return normalizeArrayValue(field, value);
    if (field.type === "blocks") return normalizeBlocksValue(field, value);
    if (field.type === "checkbox") return typeof value === "boolean" ? value : value === "true";
    if (field.type === "group" && isRecord(value)) return normalizeDataForFields(field.fields || [], value).data;
    if (field.type === "richText") return createLexicalText(value);
    if (["radio", "select"].includes(field.type || "")) return normalizeOptionValue(field, value);
    if (["email", "text", "textarea"].includes(field.type || "")) return value === null ? value : String(value);
    if (field.type === "date") {
        const date = new Date(String(value));
        return Number.isNaN(date.getTime()) ? value : date.toISOString();
    }
    return value;
};

const normalizeAuthData = (collectionConfig: CollectionConfig | undefined, normalized: NormalizedData) => {
    if (!isAuthCollection(collectionConfig)) return normalized;

    const email = normalized.data.email;
    const password = normalized.data.password;

    if (email !== undefined && typeof email !== "string") {
        normalized.data.email = String(email);
        normalized.coercedFields.push("email");
    }

    if (password !== undefined && typeof password !== "string") {
        normalized.data.password = String(password);
        normalized.coercedFields.push("password");
    }

    if (typeof normalized.data.password === "string" && normalized.data.password.length > 0 && normalized.data.password.length < 8) {
        throw new Error("Password must be at least 8 characters long.");
    }

    return normalized;
};

const getAliasFieldName = (key: string, fieldsByName: Map<string, FieldConfig>) => {
    if (fieldsByName.has(key)) return key;

    if (key.endsWith("Date")) {
        const dateAlias = `${key.slice(0, -4)}At`;
        if (fieldsByName.has(dateAlias)) return dateAlias;
    }

    return null;
};

const normalizeLooseKnownFieldValue = (key: string, value: unknown) => {
    if (key === "tags" && Array.isArray(value)) {
        return value.map((item) => (isRecord(item) ? item : { label: item }));
    }

    return value;
};

const normalizeDataForFields = (fields: FieldConfig[], data: Record<string, unknown>): NormalizedData => {
    const namedFields = getNamedFields(fields);
    const fieldsByName = new Map(namedFields.map((field) => [field.name, field]));
    const normalizedData: Record<string, unknown> = {};
    const droppedFields: string[] = [];
    const coercedFields: string[] = [];

    for (const [key, value] of Object.entries(data)) {
        const fieldName = getAliasFieldName(key, fieldsByName);

        if (!fieldName) {
            const looseValue = normalizeLooseKnownFieldValue(key, value);

            if (looseValue !== value) {
                normalizedData[key] = looseValue;
                coercedFields.push(key);
                continue;
            }

            droppedFields.push(key);
            continue;
        }

        const field = fieldsByName.get(fieldName);
        if (!field) continue;

        const normalizedValue = normalizeFieldValue(field, value);

        if (normalizedValue === SKIP_FIELD) {
            droppedFields.push(key);
            continue;
        }

        if (fieldName !== key || normalizedValue !== value) {
            coercedFields.push(key);
        }

        normalizedData[fieldName] = normalizedValue;
    }

    return {
        coercedFields,
        data: normalizedData,
        droppedFields,
    };
};

const getErrorDetails = (err: unknown) => {
    if (err instanceof Error) {
        return {
            message: err.message,
            name: err.name,
            stack:
                process.env.NODE_ENV === "development" ? err.stack : undefined,
        };
    }

    return {
        message: String(err),
        name: "UnknownError",
    };
};

export const createAIApplyActionEndpointHandler = (options: AIApplyActionEndpointOptions = {}): PayloadHandler => async (req) => {
    if (!req.user) return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json ? ((await req.json().catch(() => null)) as AIApplyActionBody | null) : null;

    const proposal = body?.proposal;
    if (!proposal) return Response.json({ error: "Proposal is required" }, { status: 400 });

    let normalized: NormalizedData | undefined;

    try {
        if (proposal.action === "updateGlobal") {
            if (!isKnownGlobal(req, proposal.slug))
                return Response.json({ error: "Unknown global" }, { status: 400 });

            const globalConfig = req.payload.config.globals?.find((global) => global.slug === proposal.slug,);
            normalized = normalizeDataForFields((globalConfig?.fields || []) as FieldConfig[], proposal.data);
            const doc = await req.payload.updateGlobal({
                data: normalized.data,
                overrideAccess: false,
                req,
                slug: proposal.slug as never,
            });

            return Response.json({ doc, normalized, status: "applied" });
        }

        if (!isAllowedCollection(req, proposal.collection, options.collections))
            return Response.json({ error: "Unknown collection" }, { status: 400 });

        if (proposal.action === "delete") {
            const doc = await req.payload.delete({
                collection: proposal.collection as never,
                id: proposal.id,
                overrideAccess: false,
                req,
            });

            return Response.json({ doc, status: "applied" });
        }

        const collectionConfig = req.payload.config.collections.find((collection) => collection.slug === proposal.collection) as CollectionConfig | undefined;
        normalized = normalizeAuthData(
            collectionConfig,
            normalizeDataForFields(getCollectionFields(collectionConfig), proposal.data)
        );

        if (proposal.action === "create" && isAuthCollection(collectionConfig) && !normalized.data.password) {
            return Response.json(
                {
                    error: "Password is required when creating a user.",
                    normalized,
                    proposal,
                },
                { status: 400 },
            );
        }

        if (proposal.action === "create" && isAuthCollection(collectionConfig) && !normalized.data.email) {
            return Response.json(
                {
                    error: "Email is required when creating a user.",
                    normalized,
                    proposal,
                },
                { status: 400 },
            );
        }

        if (proposal.action === "create") {
            const doc = await req.payload.create({
                collection: proposal.collection as never,
                data: normalized.data,
                overrideAccess: false,
                req,
            });

            return Response.json({ doc, normalized, status: "applied" });
        }

        const doc = await req.payload.update({
            collection: proposal.collection as never,
            data: normalized.data,
            id: proposal.id,
            overrideAccess: false,
            req,
        });

        return Response.json({ doc, normalized, status: "applied" });
    } catch (err) {
        const errorDetails = getErrorDetails(err);

        req.payload.logger.error({
            err,
            msg: "AI apply action failed",
            proposal,
        });

        return Response.json(
            {
                error: errorDetails.message,
                errorDetails,
                normalized,
                proposal,
            },
            { status: 400 },
        );
    }
};

export const aiApplyActionEndpointHandler = createAIApplyActionEndpointHandler();

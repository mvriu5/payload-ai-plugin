import type { PayloadHandler } from "payload";

import {
  getCollectionSlugsForAction,
  type ResolvedAICollectionPermissionMap,
} from "./collectionPermissions.js";
import { getSerializableLabel, isInternalCollection } from "./shared.js";

export type AIChatMention = {
  collection?: string;
  id?: string;
  label?: string;
  parent?: string;
  slug?: string;
  type?: "block" | "collection" | "doc" | "global";
};

export type FieldConfig = {
  blocks?: BlockConfig[];
  fields?: FieldConfig[];
  hasMany?: boolean;
  label?: unknown;
  name?: string;
  relationTo?: unknown;
  required?: boolean;
  type?: string;
};

type BlockConfig = {
  fields?: FieldConfig[];
  labels?: {
    plural?: unknown;
    singular?: unknown;
  };
  slug: string;
};

type MentionContext = {
  blockContexts: (Record<string, unknown> & {
    parent: string;
    slug: string;
  })[];
  collectionSlugs: string[];
  globalSlugs: string[];
  mentions?: AIChatMention[];
  req: Parameters<PayloadHandler>[0];
};

const getSerializableRelationTo = (relationTo: unknown) => {
  if (typeof relationTo === "string") {
    return relationTo;
  }

  if (
    Array.isArray(relationTo) &&
    relationTo.every((item) => typeof item === "string")
  ) {
    return relationTo;
  }

  return undefined;
};

export const describeField = (field: FieldConfig): Record<string, unknown> => {
  const label = getSerializableLabel(field.label);
  const relationTo = getSerializableRelationTo(field.relationTo);

  return {
    ...(label ? { label } : {}),
    ...(field.name ? { name: field.name } : {}),
    ...(field.type ? { type: field.type } : {}),
    ...(field.required ? { required: field.required } : {}),
    ...(field.hasMany ? { hasMany: field.hasMany } : {}),
    ...(relationTo ? { relationTo } : {}),
    ...(field.fields ? { fields: field.fields.map(describeField) } : {}),
    ...(field.blocks ? { blocks: field.blocks.map(describeBlock) } : {}),
  };
};

const describeBlock = (block: BlockConfig): Record<string, unknown> => {
  return {
    fields: (block.fields || []).map(describeField),
    label: getSerializableLabel(block.labels?.singular) || block.slug,
    slug: block.slug,
  };
};

export const collectBlocks = ({
  fields,
  parent,
}: {
  fields: FieldConfig[];
  parent: string;
}) => {
  const blocks: (Record<string, unknown> & {
    parent: string;
    slug: string;
  })[] = [];

  for (const field of fields) {
    if (field.type === "blocks" && field.blocks) {
      for (const block of field.blocks) {
        blocks.push({
          ...describeBlock(block),
          parent,
          slug: block.slug,
        });

        blocks.push(
          ...collectBlocks({
            fields: block.fields || [],
            parent: `${parent}/${block.slug}`,
          }),
        );
      }
    }

    if (field.fields) {
      blocks.push(
        ...collectBlocks({
          fields: field.fields,
          parent,
        }),
      );
    }
  }

  return blocks;
};

export const getAllowedCollectionSlugs = (
  req: Parameters<PayloadHandler>[0],
  collections?: ResolvedAICollectionPermissionMap,
) => {
  return getCollectionSlugsForAction({
    action: "read",
    permissions: collections,
    req,
  });
};

export const getMentionContext = async ({
  blockContexts,
  collectionSlugs,
  globalSlugs,
  mentions,
  req,
}: MentionContext) => {
  if (!mentions || mentions.length === 0) return [];

  const context: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const mention of mentions.slice(0, 8)) {
    if (mention.type === "collection" && mention.slug) {
      const slug = mention.slug;
      const key = `collection:${slug}`;

      if (
        seen.has(key) ||
        isInternalCollection(slug) ||
        !collectionSlugs.includes(slug)
      )
        continue;

      const collectionConfig = req.payload.config.collections.find(
        (collection) => collection.slug === slug,
      );
      if (!collectionConfig) continue;

      seen.add(key);
      context.push({
        fields: (collectionConfig.fields as FieldConfig[]).map(describeField),
        label:
          collectionConfig.labels?.plural ||
          collectionConfig.labels?.singular ||
          slug,
        slug,
        type: "collection",
      });
    }

    if (mention.type === "global" && mention.slug) {
      const slug = mention.slug;
      const key = `global:${slug}`;

      if (seen.has(key) || !globalSlugs.includes(slug)) continue;

      const globalConfig = req.payload.config.globals?.find(
        (global) => global.slug === slug,
      );
      if (!globalConfig) continue;

      const globalDoc = await req.payload
        .findGlobal({
          depth: 2,
          overrideAccess: false,
          req,
          slug: slug as never,
        })
        .catch(() => null);

      seen.add(key);
      context.push({
        doc: globalDoc,
        fields: (globalConfig.fields as FieldConfig[]).map(describeField),
        label: globalConfig.label || slug,
        slug,
        type: "global",
      });
    }

    if (mention.type === "block" && mention.slug) {
      const matchingBlocks = blockContexts.filter(
        (block) =>
          block.slug === mention.slug &&
          (!mention.parent || block.parent === mention.parent),
      );

      for (const block of matchingBlocks) {
        const key = `block:${block.parent}:${block.slug}`;

        if (seen.has(key)) continue;

        seen.add(key);
        context.push({
          ...block,
          type: "block",
        });
      }
    }

    if (mention.type === "doc" && mention.collection && mention.id) {
      const slug = mention.collection;
      const key = `doc:${slug}:${mention.id}`;

      if (
        seen.has(key) ||
        isInternalCollection(slug) ||
        !collectionSlugs.includes(slug)
      )
        continue;

      const doc = await req.payload
        .findByID({
          collection: slug as never,
          depth: 2,
          id: mention.id,
          overrideAccess: false,
          req,
        })
        .catch(() => null);

      if (!doc) continue;

      seen.add(key);
      context.push({
        collection: slug,
        doc,
        id: mention.id,
        label: mention.label || mention.id,
        type: "doc",
      });
    }
  }

  return context;
};

export const buildPromptWithMentionContext = ({
  mentionContext,
  prompt,
}: {
  mentionContext: Record<string, unknown>[];
  prompt: string;
}) => {
  if (mentionContext.length === 0) return prompt;

  return [
    "The user selected the following Payload CMS references in the input. Treat inline text like `collection: Name` or `document: Name` as references to this context, not as literal content.",
    JSON.stringify(mentionContext, null, 2),
    "User request:",
    prompt,
  ].join("\n\n");
};

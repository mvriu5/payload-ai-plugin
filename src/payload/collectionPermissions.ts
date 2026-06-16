import type { PayloadHandler } from "payload";

import { isInternalCollection } from "./shared.js";

export type AICollectionAction = "create" | "delete" | "read" | "update";

export type AICollectionPermissions = Partial<
  Record<AICollectionAction, boolean>
>;

export type AICollectionPermissionConfig =
  | true
  | AICollectionPermissions;

export type AICollectionPermissionMap = Partial<
  Record<string, AICollectionPermissionConfig>
>;

export type ResolvedAICollectionPermissionMap = Partial<
  Record<string, Record<AICollectionAction, boolean>>
>;

const allActions: AICollectionAction[] = ["create", "delete", "read", "update"];

const getKnownCollectionSlugs = (req: Parameters<PayloadHandler>[0]) => {
  return req.payload.config.collections
    .map((collection) => collection.slug)
    .filter((slug) => !isInternalCollection(slug));
};

export const resolveCollectionPermissions = (
  collections?: AICollectionPermissionMap,
): ResolvedAICollectionPermissionMap | undefined => {
  if (!collections) return undefined;

  return Object.fromEntries(
    Object.entries(collections).map(([slug, config]) => {
      if (config === true) {
        return [
          slug,
          {
            create: true,
            delete: true,
            read: true,
            update: true,
          },
        ];
      }

      if (!config) {
        return [
          slug,
          {
            create: false,
            delete: false,
            read: false,
            update: false,
          },
        ];
      }

      return [
        slug,
        {
          create: Boolean(config.create),
          delete: Boolean(config.delete),
          read: Boolean(config.read),
          update: Boolean(config.update),
        },
      ];
    }),
  );
};

export const getCollectionSlugsForAction = ({
  action,
  permissions,
  req,
}: {
  action: AICollectionAction;
  permissions?: ResolvedAICollectionPermissionMap;
  req: Parameters<PayloadHandler>[0];
}) => {
  const knownSlugs = getKnownCollectionSlugs(req);

  if (!permissions) return knownSlugs;

  return knownSlugs.filter((slug) => Boolean(permissions[slug]?.[action]));
};

export const isCollectionActionAllowed = ({
  action,
  permissions,
  req,
  slug,
}: {
  action: AICollectionAction;
  permissions?: ResolvedAICollectionPermissionMap;
  req: Parameters<PayloadHandler>[0];
  slug: string;
}) => {
  if (!getKnownCollectionSlugs(req).includes(slug)) return false;
  if (!permissions) return true;

  return Boolean(permissions[slug]?.[action]);
};

export const getCollectionPermissions = ({
  permissions,
  slug,
}: {
  permissions?: ResolvedAICollectionPermissionMap;
  slug: string;
}) => {
  if (!permissions) {
    return Object.fromEntries(allActions.map((action) => [action, true])) as Record<
      AICollectionAction,
      boolean
    >;
  }

  return (
    permissions[slug] ||
    (Object.fromEntries(allActions.map((action) => [action, false])) as Record<
      AICollectionAction,
      boolean
    >)
  );
};

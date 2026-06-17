import type { PayloadHandler } from "payload";

import { verifyAIActionProposal } from "../ai/proposals.js";
import { containsSensitiveData, redactSensitiveData } from "../ai/sensitiveData.js";
import {
  getCollectionFields,
  isAuthCollection,
  normalizeAuthData,
  normalizeDataForFields,
  type CollectionConfig,
  type FieldConfig,
  type NormalizedData,
} from "../payload/normalizeData.js";
import type { AIActionProposal } from "./aiChatEndpointHandler.js";
import {
  isCollectionActionAllowed,
  type AICollectionAction,
  type ResolvedAICollectionPermissionMap,
} from "../payload/collectionPermissions.js";

type AIApplyActionBody = {
  proposal?: AIActionProposal;
};

type AIApplyActionEndpointOptions = {
  changeLogCollection?: string;
  collections?: ResolvedAICollectionPermissionMap;
};

type AppliedDoc = {
  id?: unknown;
};

type ProposalMeta = {
  action?: unknown;
  collection?: unknown;
  id?: unknown;
  slug?: unknown;
};

type ChangeLogTarget = {
  after: unknown;
  before: unknown;
  documentID?: unknown;
};

const getProposalMeta = (
  proposal?: Partial<AIActionProposal>,
): ProposalMeta => {
  if (!proposal) return {};

  return {
    action: proposal.action,
    collection: "collection" in proposal ? proposal.collection : undefined,
    id: "id" in proposal ? proposal.id : undefined,
    slug: "slug" in proposal ? proposal.slug : undefined,
  };
};

const getAppliedDocReference = (doc: AppliedDoc | null | undefined) => {
  return doc?.id === undefined ? undefined : { id: doc.id };
};

const isAllowedCollection = (
  req: Parameters<PayloadHandler>[0],
  collection: string,
  collections?: ResolvedAICollectionPermissionMap,
  action: AICollectionAction = "read",
) => {
  return isCollectionActionAllowed({
    action,
    permissions: collections,
    req,
    slug: collection,
  });
};

const isKnownGlobal = (req: Parameters<PayloadHandler>[0], slug: string) => {
  return (
    req.payload.config.globals?.some((item) => item.slug === slug) || false
  );
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const mergeData = (
  current: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries({
      ...current,
      ...next,
    }).map(([key, value]) => {
      const currentValue = current[key];

      if (isRecord(currentValue) && isRecord(value)) {
        return [key, mergeData(currentValue, value)];
      }

      return [key, value];
    }),
  );
};

const getJSONLineKey = (line: string) => {
  const match = /^(\s*)"([^"]+)":/.exec(line);

  return match ? `${match[1]}${match[2]}` : null;
};

const countDiffChanges = ({
  after,
  before,
}: {
  after: unknown;
  before: unknown;
}) => {
  const beforeLines = JSON.stringify(before, null, 2).split("\n");
  const afterLines = JSON.stringify(after, null, 2).split("\n");
  const dp = Array.from({ length: beforeLines.length + 1 }, () =>
    Array(afterLines.length + 1).fill(0) as number[],
  );
  let additions = 0;
  let removals = 0;

  for (let i = beforeLines.length - 1; i >= 0; i -= 1) {
    for (let j = afterLines.length - 1; j >= 0; j -= 1) {
      dp[i][j] =
        beforeLines[i] === afterLines[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  let beforeIndex = 0;
  let afterIndex = 0;

  while (beforeIndex < beforeLines.length && afterIndex < afterLines.length) {
    if (beforeLines[beforeIndex] === afterLines[afterIndex]) {
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    const beforeKey = getJSONLineKey(beforeLines[beforeIndex]);
    const afterKey = getJSONLineKey(afterLines[afterIndex]);

    if (beforeKey && beforeKey === afterKey) {
      removals += 1;
      additions += 1;
      beforeIndex += 1;
      afterIndex += 1;
      continue;
    }

    if (dp[beforeIndex + 1][afterIndex] >= dp[beforeIndex][afterIndex + 1]) {
      removals += 1;
      beforeIndex += 1;
    } else {
      additions += 1;
      afterIndex += 1;
    }
  }

  removals += beforeLines.length - beforeIndex;
  additions += afterLines.length - afterIndex;

  return { additions, removals };
};

const getTargetURL = ({
  documentID,
  proposal,
  req,
}: {
  documentID?: unknown;
  proposal: AIActionProposal;
  req: Parameters<PayloadHandler>[0];
}) => {
  const adminRoute = req.payload.config.routes.admin || "/admin";

  if (proposal.action === "updateGlobal") {
    return `${adminRoute}/globals/${proposal.slug}`;
  }

  if (proposal.action === "delete") {
    return null;
  }

  const id = proposal.action === "create" ? documentID : proposal.id;

  if (!id) return null;

  return `${adminRoute}/collections/${proposal.collection}/${id}`;
};

const getUserID = (req: Parameters<PayloadHandler>[0]) => {
  const user = req.user as { id?: unknown } | null | undefined;

  return user?.id === undefined ? undefined : String(user.id);
};

const logAIChange = async ({
  changeLogCollection,
  target,
  proposal,
  req,
}: {
  changeLogCollection?: string;
  proposal: AIActionProposal;
  req: Parameters<PayloadHandler>[0];
  target: ChangeLogTarget;
}) => {
  if (!changeLogCollection) return null;

  const before = redactSensitiveData(target.before);
  const after = redactSensitiveData(target.after);
  const { additions, removals } = countDiffChanges({ after, before });
  const proposalForLog = { ...proposal } as Record<string, unknown>;

  delete proposalForLog._aiSignature;

  try {
    await req.payload.create({
      collection: changeLogCollection as never,
      data: {
        action: proposal.action,
        additions,
        after,
        before,
        collection: "collection" in proposal ? proposal.collection : undefined,
        documentID:
          target.documentID === undefined ? undefined : String(target.documentID),
        proposal: redactSensitiveData(proposalForLog),
        removals,
        slug: "slug" in proposal ? proposal.slug : undefined,
        targetType: proposal.action === "updateGlobal" ? "global" : "collection",
        targetURL: getTargetURL({
          documentID: target.documentID,
          proposal,
          req,
        }),
        title: proposal.label,
        userID: getUserID(req),
      },
      overrideAccess: true,
      req,
    });

    return {
      action: proposal.action,
      additions,
      after,
      before,
      collection: "collection" in proposal ? proposal.collection : null,
      documentID:
        target.documentID === undefined ? null : String(target.documentID),
      removals,
      slug: "slug" in proposal ? proposal.slug : null,
      title: proposal.label,
      url: getTargetURL({
        documentID: target.documentID,
        proposal,
        req,
      }),
    };
  } catch (err) {
    req.payload.logger.error({
      err,
      msg: "AI change log entry could not be written",
      proposal: getProposalMeta(proposal),
    });

    return null;
  }
};

const isActionProposal = (proposal: unknown): proposal is AIActionProposal => {
  if (!isRecord(proposal) || typeof proposal.label !== "string") return false;

  if (proposal.action === "create") {
    return typeof proposal.collection === "string" && isRecord(proposal.data);
  }

  if (proposal.action === "update") {
    return (
      typeof proposal.collection === "string" &&
      typeof proposal.id === "string" &&
      isRecord(proposal.data)
    );
  }

  if (proposal.action === "delete") {
    return (
      typeof proposal.collection === "string" && typeof proposal.id === "string"
    );
  }

  if (proposal.action === "updateGlobal") {
    return typeof proposal.slug === "string" && isRecord(proposal.data);
  }

  return false;
};

export const createAIApplyActionEndpointHandler =
  (options: AIApplyActionEndpointOptions = {}): PayloadHandler =>
  async (req) => {
    if (!req.user)
      return Response.json({ error: "Unauthorized" }, { status: 401 });

    const body = req.json
      ? ((await req.json().catch(() => null)) as AIApplyActionBody | null)
      : null;

    const proposal = body?.proposal;
    if (!proposal)
      return Response.json({ error: "Proposal is required" }, { status: 400 });
    if (!verifyAIActionProposal(proposal))
      return Response.json(
        { error: "Proposal signature is invalid or expired." },
        { status: 400 },
      );
    if (!isActionProposal(proposal))
      return Response.json({ error: "Proposal is invalid." }, { status: 400 });
    if ("data" in proposal && containsSensitiveData(proposal.data))
      return Response.json(
        { error: "Proposal contains sensitive fields and cannot be applied." },
        { status: 400 },
      );

    let normalized: NormalizedData | undefined;

    try {
      if (proposal.action === "updateGlobal") {
        if (!isKnownGlobal(req, proposal.slug))
          return Response.json({ error: "Unknown global" }, { status: 400 });

        const globalConfig = req.payload.config.globals?.find(
          (global) => global.slug === proposal.slug,
        );
        normalized = normalizeDataForFields(
          (globalConfig?.fields || []) as FieldConfig[],
          proposal.data,
        );
        const before = (await req.payload.findGlobal({
          depth: 2,
          req,
          slug: proposal.slug as never,
        })) as Record<string, unknown>;
        const doc = await req.payload.updateGlobal({
          data: normalized.data,
          overrideAccess: false,
          req,
          slug: proposal.slug as never,
        });
        const change = await logAIChange({
          changeLogCollection: options.changeLogCollection,
          proposal,
          req,
          target: {
            after: mergeData(before, normalized.data),
            before,
          },
        });

        return Response.json({
          change,
          doc: getAppliedDocReference(doc),
          status: "applied",
        });
      }

      if (
        !isAllowedCollection(
          req,
          proposal.collection,
          options.collections,
          proposal.action,
        )
      )
        return Response.json({ error: "Unknown collection" }, { status: 400 });

      if (proposal.action === "delete") {
        const doc = await req.payload.delete({
          collection: proposal.collection as never,
          id: proposal.id,
          overrideAccess: false,
          req,
        });
        const change = await logAIChange({
          changeLogCollection: options.changeLogCollection,
          proposal,
          req,
          target: {
            after: {},
            before: doc,
            documentID: proposal.id,
          },
        });

        return Response.json({
          change,
          doc: getAppliedDocReference(doc),
          status: "applied",
        });
      }

      const collectionConfig = req.payload.config.collections.find(
        (collection) => collection.slug === proposal.collection,
      ) as CollectionConfig | undefined;
      normalized = normalizeAuthData(
        collectionConfig,
        normalizeDataForFields(
          getCollectionFields(collectionConfig),
          proposal.data,
        ),
      );

      if (
        proposal.action === "create" &&
        isAuthCollection(collectionConfig) &&
        !normalized.data.password
      ) {
        return Response.json(
          {
            error: "Password is required when creating a user.",
          },
          { status: 400 },
        );
      }

      if (
        proposal.action === "create" &&
        isAuthCollection(collectionConfig) &&
        !normalized.data.email
      ) {
        return Response.json(
          {
            error: "Email is required when creating a user.",
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
        const change = await logAIChange({
          changeLogCollection: options.changeLogCollection,
          proposal,
          req,
          target: {
            after: doc,
            before: {},
            documentID: doc.id,
          },
        });

        return Response.json({
          change,
          doc: getAppliedDocReference(doc),
          status: "applied",
        });
      }

      const before = (await req.payload.findByID({
        collection: proposal.collection as never,
        depth: 2,
        id: proposal.id,
        req,
      })) as Record<string, unknown>;
      const doc = await req.payload.update({
        collection: proposal.collection as never,
        data: normalized.data,
        id: proposal.id,
        overrideAccess: false,
        req,
      });
      const change = await logAIChange({
        changeLogCollection: options.changeLogCollection,
        proposal,
        req,
        target: {
          after: mergeData(before, normalized.data),
          before,
          documentID: proposal.id,
        },
      });

      return Response.json({
        change,
        doc: getAppliedDocReference(doc),
        status: "applied",
      });
    } catch (err) {
      req.payload.logger.error({
        err,
        msg: "AI apply action failed",
        proposal: getProposalMeta(proposal),
      });

      return Response.json(
        {
          error: "Could not apply proposal.",
        },
        { status: 400 },
      );
    }
  };

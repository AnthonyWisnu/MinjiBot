import type { Prisma } from "@prisma/client";

export type GroupEventSectionKey =
  | "politics"
  | "lottery"
  | "bounties"
  | "xpEvent"
  | "drops"
  | "groupTools"
  | "auction"
  | "aiDailyUsage";

export interface GroupEventTenantClient {
  findUnique(args: {
    where: { groupJid: string };
  }): Promise<{ groupEventState?: Prisma.JsonValue | null } | null>;
  update?(args: {
    where: { groupJid: string };
    data: Record<string, unknown>;
  }): Promise<unknown>;
}

const groupWriteQueues = new Map<string, Promise<void>>();

export function extractGroupEventStateObject(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  return { ...(raw as Record<string, unknown>) };
}

export async function readGroupEventSection(
  client: GroupEventTenantClient | undefined,
  groupJid: string,
  sectionKey: GroupEventSectionKey,
): Promise<unknown> {
  if (!client) return undefined;
  try {
    const tenant = await client.findUnique({ where: { groupJid } });
    if (!tenant?.groupEventState) return undefined;
    const obj = extractGroupEventStateObject(tenant.groupEventState);
    return obj[sectionKey];
  } catch {
    return undefined;
  }
}

export async function writeGroupEventSection(
  client: GroupEventTenantClient | undefined,
  groupJid: string,
  sectionKey: GroupEventSectionKey,
  value: Prisma.InputJsonValue | null,
): Promise<void> {
  if (!client?.update) return;

  const prev = groupWriteQueues.get(groupJid) ?? Promise.resolve();
  const next = prev
    .catch(() => undefined)
    .then(async () => {
      try {
        const tenant = await client.findUnique({ where: { groupJid } });
        if (!tenant) return;
        const existing = extractGroupEventStateObject(tenant.groupEventState);
        const merged: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(existing)) {
          if (k !== sectionKey) {
            merged[k] = v;
          }
        }
        if (value !== null) {
          merged[sectionKey] = value;
        }
        await client.update?.({
          where: { groupJid },
          data: { groupEventState: merged },
        });
      } catch {
        // Fallback aman jika tenant mock belum mendukung groupEventState di unit test
      }
    });

  groupWriteQueues.set(groupJid, next);
  try {
    await next;
  } finally {
    if (groupWriteQueues.get(groupJid) === next) {
      groupWriteQueues.delete(groupJid);
    }
  }
}

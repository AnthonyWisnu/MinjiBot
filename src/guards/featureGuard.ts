import { roleGuard } from "./roleGuard";
import type { CommandContext } from "../types/command";
import type { TenantFeatureKey } from "../types/feature";
import { tenantFeatureService } from "../services/tenant/tenantFeature.service";

interface TenantFeatureLookup {
  isFeatureEnabled(groupJid: string, feature: TenantFeatureKey): Promise<boolean>;
}

const COMMAND_FEATURE_MAP = new Map<string, TenantFeatureKey>([
  ["tt", "downloader"],
  ["ig", "downloader"],
  ["igstory", "downloader"],
  ["hd", "hd"],
  ["remind", "reminder"],
  ["remindall", "reminder"],
  ["listreminder", "reminder"],
  ["delreminder", "reminder"],
  ["tagall", "tagall"],
  ["kuis", "game"],
  ["family100", "game"],
  ["tebakkata", "game"],
  ["tebakemoji", "game"],
  ["tebakangka", "game"],
  ["tictactoe", "game"],
  ["nyerah", "game"],
]);

export type FeatureGuardResult =
  | {
      allowed: true;
    }
  | {
      allowed: false;
      message: string;
    };

export class FeatureGuard {
  constructor(private readonly featureLookup: TenantFeatureLookup = tenantFeatureService) {}

  async checkCommandFeature(context: CommandContext): Promise<FeatureGuardResult> {
    if (!context.isGroup || context.commandName === "feature") {
      return { allowed: true };
    }

    const sender = context.senderUserJid ?? context.senderJid;
    if (sender && roleGuard.isSuperOwner(sender)) {
      return { allowed: true };
    }

    const feature = COMMAND_FEATURE_MAP.get(context.commandName);
    if (!feature || !context.tenantGroup) {
      return { allowed: true };
    }

    const enabled = await this.featureLookup.isFeatureEnabled(
      context.tenantGroup.groupJid,
      feature,
    );

    if (enabled) {
      return { allowed: true };
    }

    return {
      allowed: false,
      message: "Fitur ini sedang dinonaktifkan untuk grup ini.",
    };
  }
}

export const featureGuard = new FeatureGuard();

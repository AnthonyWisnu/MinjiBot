#!/usr/bin/env node
/**
 * One-off safe balance redenomination migration ONLY for tenant MNJ-F650.
 *
 * Rules approved by group owner:
 * - Wallet (moneyBalance), Bank (bankBalance), and Deposito principal: -50% flat across all members.
 * - Level, XP, Points, Limit, Weapons/Armor/Pickaxe/Rod (durability serviced to 100%),
 *   Pets, Properties, Crates, Items, Crypto, Stocks, Cards, Career, Startup, Custom Title: 100% INTACT.
 * - Skills (str/agi/luk/int/cha) reset cleanly to 0 for free re-allocation (total SP remains 100% intact).
 * - HP restored to 100, jail/UGD timers & stale boss cooldowns cleared, worldBossState reset cleanly.
 *
 * Usage:
 *   node scripts/migrate-mnj-f650-50pct.cjs           # Dry-run (default, read-only)
 *   node scripts/migrate-mnj-f650-50pct.cjs --apply   # Backup JSON + atomic Prisma transaction
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function loadEnvIfNeeded(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) {
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  }
}

loadEnvIfNeeded(path.resolve(__dirname, "..", ".env"));
if (!process.env.DATABASE_URL && fs.existsSync("/home/anthony/MinjiBot/.env")) {
  loadEnvIfNeeded("/home/anthony/MinjiBot/.env");
}

const { PrismaClient } = require("@prisma/client");

const TARGET_TENANT_CODE = "MNJ-F650";
const TOOL_KEYS = ["sword", "armor", "pickaxe", "fishingrod"];

function parseState(raw) {
  if (!raw) return {};
  if (typeof raw === "object" && !Array.isArray(raw)) {
    return JSON.parse(JSON.stringify(raw));
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }
  return {};
}

function transformRpgState(rawState) {
  if (rawState === null || rawState === undefined) {
    return { nextState: null, depBefore: 0n, depAfter: 0n };
  }
  const next = parseState(rawState);
  let depBefore = 0n;
  let depAfter = 0n;

  if (next.deposito && typeof next.deposito === "object" && next.deposito.principal !== undefined) {
    try {
      depBefore = BigInt(next.deposito.principal || "0");
      depAfter = depBefore / 2n;
      next.deposito = {
        ...next.deposito,
        principal: depAfter.toString(),
      };
    } catch {
      depBefore = 0n;
      depAfter = 0n;
    }
  }

  // Keep all owned tool levels 100% intact and service durability to 100%
  if (next.tools && typeof next.tools === "object") {
    for (const key of TOOL_KEYS) {
      const entry = next.tools[key];
      if (entry && typeof entry === "object" && Number(entry.level || 0) > 0) {
        next.tools[key] = {
          ...entry,
          level: Number(entry.level),
          durability: 100,
        };
      }
    }
  }

  // Free skill reset so members can re-distribute SP under the rebalanced combat formula
  next.skills = { str: 0, agi: 0, luk: 0, int: 0, cha: 0 };

  // Clean recovery state for Season 2 launch
  next.hp = 100;
  next.jailedUntil = 0;
  next.ugdUntil = 0;

  if (next.cooldowns && typeof next.cooldowns === "object") {
    const cleanedCooldowns = { ...next.cooldowns };
    for (const k of Object.keys(cleanedCooldowns)) {
      if (k.startsWith("fight_") || k === "worldboss_hit") {
        delete cleanedCooldowns[k];
      }
    }
    next.cooldowns = cleanedCooldowns;
  }

  return { nextState: next, depBefore, depAfter };
}

function fmtCompact(n) {
  const v = Number(n);
  if (v >= 1e9) return `Rp ${(v / 1e9).toFixed(2)} M`;
  if (v >= 1e6) return `Rp ${(v / 1e6).toFixed(2)} Jt`;
  return `Rp ${Math.round(v).toLocaleString("id-ID")}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  try {
    const tenant = await prisma.tenantGroup.findFirst({
      where: { tenantCode: TARGET_TENANT_CODE },
    });
    if (!tenant) {
      throw new Error(`Tenant with code ${TARGET_TENANT_CODE} not found!`);
    }
    if (tenant.tenantCode !== TARGET_TENANT_CODE) {
      throw new Error(`Safety guard triggered: unexpected tenantCode ${tenant.tenantCode}`);
    }

    const profiles = await prisma.groupMemberProfile.findMany({
      where: { groupJid: tenant.groupJid },
      orderBy: [{ moneyBalance: "desc" }],
    });

    const correlationId = crypto.randomUUID();
    const plans = [];

    let totalBefore = 0n;
    let totalAfter = 0n;

    for (const p of profiles) {
      const walletBefore = BigInt(p.moneyBalance || 0n);
      const bankBefore = BigInt(p.bankBalance || 0n);
      const walletAfter = walletBefore / 2n;
      const bankAfter = bankBefore / 2n;

      const { nextState, depBefore, depAfter } = transformRpgState(p.rpgState);
      const liqBefore = walletBefore + bankBefore + depBefore;
      const liqAfter = walletAfter + bankAfter + depAfter;

      totalBefore += liqBefore;
      totalAfter += liqAfter;

      plans.push({
        id: p.id,
        userJid: p.userJid,
        level: p.level,
        walletBefore,
        walletAfter,
        bankBefore,
        bankAfter,
        depBefore,
        depAfter,
        liqBefore,
        liqAfter,
        nextState,
      });
    }

    plans.sort((a, b) => (b.liqBefore > a.liqBefore ? 1 : b.liqBefore < a.liqBefore ? -1 : 0));

    console.log(
      JSON.stringify(
        {
          mode: apply ? "APPLY" : "DRY_RUN",
          tenant: {
            code: tenant.tenantCode,
            groupJid: tenant.groupJid,
            name: tenant.name,
            status: tenant.status,
          },
          profilesCount: plans.length,
          totalLiquidBefore: totalBefore.toString(),
          totalLiquidAfter: totalAfter.toString(),
          top15Preview: plans.slice(0, 15).map((r, idx) => ({
            rank: idx + 1,
            user: r.userJid.replace(/@.*/, ""),
            lv: r.level,
            before: fmtCompact(r.liqBefore),
            after: fmtCompact(r.liqAfter),
            walletAfter: fmtCompact(r.walletAfter),
            bankAfter: fmtCompact(r.bankAfter),
            depositoAfter: fmtCompact(r.depAfter),
          })),
        },
        null,
        2,
      ),
    );

    if (!apply) {
      console.log("\nDRY_RUN complete. Re-run with --apply to write backup and execute transaction.");
      return;
    }

    const backupDir = path.resolve(process.cwd(), "backups");
    fs.mkdirSync(backupDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = path.join(backupDir, `mnj-f650-pre-s2-${ts}.json`);

    fs.writeFileSync(
      backupFile,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          tenant,
          profiles,
        },
        (_k, v) => (typeof v === "bigint" ? v.toString() : v),
        2,
      ),
      "utf8",
    );
    console.log(`\nBackup saved: ${backupFile}`);

    let updatedCount = 0;
    let txCreatedCount = 0;

    await prisma.$transaction(
      async (tx) => {
        for (const item of plans) {
          await tx.groupMemberProfile.update({
            where: { id: item.id },
            data: {
              moneyBalance: item.walletAfter,
              bankBalance: item.bankAfter,
              rpgState: item.nextState,
            },
          });
          updatedCount += 1;

          const walletDelta = item.walletAfter - item.walletBefore;
          if (walletDelta !== 0n) {
            await tx.groupMemberTransaction.create({
              data: {
                profileId: item.id,
                groupJid: tenant.groupJid,
                userJid: item.userJid,
                asset: "MONEY",
                type: "CORRECTION",
                amount: walletDelta,
                balanceBefore: item.walletBefore,
                balanceAfter: item.walletAfter,
                correlationId,
                note: "mnj_f650_s2_50pct_redenomination",
              },
            });
            txCreatedCount += 1;
          }

          const bankDelta = item.bankAfter - item.bankBefore;
          if (bankDelta !== 0n) {
            await tx.groupMemberTransaction.create({
              data: {
                profileId: item.id,
                groupJid: tenant.groupJid,
                userJid: item.userJid,
                asset: "BANK",
                type: "CORRECTION",
                amount: bankDelta,
                balanceBefore: item.bankBefore,
                balanceAfter: item.bankAfter,
                correlationId,
                note: "mnj_f650_s2_50pct_redenomination",
              },
            });
            txCreatedCount += 1;
          }
        }

        await tx.tenantGroup.update({
          where: { id: tenant.id },
          data: { worldBossState: null },
        });
      },
      { timeout: 60_000 },
    );

    console.log(
      `\nMIGRATION_APPLIED successfully: profilesUpdated=${updatedCount}, ledgerRowsCreated=${txCreatedCount}, correlationId=${correlationId}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("MIGRATION_FAILED:", err);
  process.exit(1);
});

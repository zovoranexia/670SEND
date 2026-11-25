/**
 * 670Send — database seed.
 *
 * Idempotent: every row is upserted by its natural key, so `pnpm db:seed` can be
 * re-run safely. By default existing rows are LEFT UNTOUCHED (`update: {}`) so
 * edits made in the admin console (tariffs, WhatsApp templates, role grants)
 * survive a re-seed. Set SEED_FORCE_UPDATE=true to overwrite tariffs/templates/
 * settings with the values below.
 *
 * Two layers:
 *   1. REFERENCE DATA  (always)   — permissions, 8 roles, geography, hubs, zones,
 *                                   add-on tariffs, 44 WhatsApp templates, settings,
 *                                   system wallets, bootstrap Super Admin.
 *   2. DEMO DATA       (dev only) — 3 more staff users, 2 agents (Díli, Baucau),
 *                                   1 courier, 1 bus fleet partner + vehicle + driver,
 *                                   demo wallets funded through a real ledger posting.
 *      Disabled when NODE_ENV=production unless SEED_DEMO_DATA=true.
 *
 * Secrets come from the environment (see .env.example). Nothing here is printed.
 */
import { config as loadEnv } from 'dotenv';
import path from 'node:path';

loadEnv({ path: [path.resolve(process.cwd(), '.env'), path.resolve(process.cwd(), '../../.env')] });

import { Prisma, PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import {
  ALL_PERMISSION_KEYS,
  HUBS,
  LOCALES,
  MUNICIPALITIES,
  NOTIFICATION_EVENT_CODES,
  PERMISSION_CATALOG,
  ROLE_KEYS,
  ROLE_META,
  ROLE_PERMISSIONS,
  toPrismaLanguage,
  type RoleKey,
} from '@670send/types';
import { WHATSAPP_TEMPLATES } from '@670send/i18n';
import {
  ADDON_SPLIT_BPS,
  BUS_CAPACITY_DEFAULTS,
  INSURANCE,
  REVENUE_SPLIT_BPS,
  STORAGE_POLICY,
  UNINSURED_LIABILITY,
} from '@670send/pricing';

const prisma = new PrismaClient();

const IS_PROD = process.env.NODE_ENV === 'production';
const FORCE = process.env.SEED_FORCE_UPDATE === 'true';
const SEED_DEMO =
  process.env.SEED_DEMO_DATA === 'true' || (process.env.SEED_DEMO_DATA !== 'false' && !IS_PROD);

const DEFAULT_PASSWORD_FALLBACK = 'ChangeMe!670Send';
const PASSWORD = process.env.SEED_DEFAULT_PASSWORD ?? DEFAULT_PASSWORD_FALLBACK;
const PIN = process.env.SEED_DEFAULT_PIN ?? '482913';
const SUPERADMIN_EMAIL = (process.env.SEED_SUPERADMIN_EMAIL ?? 'superadmin@670send.test').toLowerCase();
const SUPERADMIN_PHONE = process.env.SEED_SUPERADMIN_PHONE ?? '+67077000001';
const SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD ?? PASSWORD;

/** In `update` position: do nothing unless SEED_FORCE_UPDATE=true. */
const keepOrForce = <T extends object>(data: T): T | Record<string, never> => (FORCE ? data : {});

const log = (msg: string) => console.log(`  ${msg}`);
const D = (v: string | number) => new Prisma.Decimal(v);

function assertSafeSecrets(): void {
  if (!IS_PROD) return;
  const weak =
    SUPERADMIN_PASSWORD === DEFAULT_PASSWORD_FALLBACK || SUPERADMIN_PASSWORD.length < 14;
  if (weak) {
    throw new Error(
      'Refusing to seed production: set SEED_SUPERADMIN_PASSWORD (≥ 14 chars, not the default) in the environment.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* 1. RBAC                                                                    */
/* -------------------------------------------------------------------------- */
async function seedRbac(): Promise<Record<RoleKey, string>> {
  console.log('▸ RBAC: permissions, roles, role_permissions');

  const catalog: Array<[string, string]> = [
    ['*:*', 'Wildcard — every module, every action (SUPER_ADMIN only)'],
    ...PERMISSION_CATALOG.map(([key, desc]) => [key, desc] as [string, string]),
  ];

  const permIds = new Map<string, string>();
  for (const [key, description] of catalog) {
    const [module = '*', action = '*'] = key.split(':');
    const p = await prisma.permission.upsert({
      where: { key },
      create: { key, module, action, description },
      update: { description },
    });
    permIds.set(key, p.id);
  }

  const roleIds = {} as Record<RoleKey, string>;
  for (const key of ROLE_KEYS) {
    const meta = ROLE_META[key];
    const role = await prisma.role.upsert({
      where: { key },
      create: { key, name: meta.name, description: meta.description, isSystem: true },
      update: { isSystem: true },
    });
    roleIds[key] = role.id;

    // Additive only: never remove a grant an administrator added or kept.
    const grants = ROLE_PERMISSIONS[key];
    await prisma.rolePermission.createMany({
      data: grants.map((g) => ({ roleId: role.id, permissionId: permIds.get(g)! })),
      skipDuplicates: true,
    });
    log(`${key.padEnd(16)} ${grants.includes('*:*') ? '*:*' : `${grants.length} permissions`}`);
  }

  log(`${permIds.size} permissions (${ALL_PERMISSION_KEYS.length} + wildcard)`);
  return roleIds;
}

/* -------------------------------------------------------------------------- */
/* 2. Geography, hubs, zones                                                  */
/* -------------------------------------------------------------------------- */
const ZONES = [
  {
    code: 'ZONE_1',
    nameTet: 'Zona 1 (Besik)', namePt: 'Zona 1 (Próxima)', nameEn: 'Zone 1 (Near)', nameId: 'Zona 1 (Dekat)',
    docRateUsd: '2.50', smallBase2kgUsd: '3.00', extraPerKgUsd: '0.75', cargoBase10kgUsd: '12.00', cargoExtraPerKgUsd: '0.75',
    etaTet: 'Loron hanesan / 1 loron', etaPt: 'No mesmo dia / 1 dia', etaEn: 'Same day / 1 day', etaId: 'Hari yang sama / 1 hari',
  },
  {
    code: 'ZONE_2',
    nameTet: 'Zona 2 (Klaran)', namePt: 'Zona 2 (Média)', nameEn: 'Zone 2 (Mid)', nameId: 'Zona 2 (Menengah)',
    docRateUsd: '3.00', smallBase2kgUsd: '4.00', extraPerKgUsd: '1.00', cargoBase10kgUsd: '14.00', cargoExtraPerKgUsd: '0.85',
    etaTet: '1 loron', etaPt: '1 dia', etaEn: '1 day', etaId: '1 hari',
  },
  {
    code: 'ZONE_3',
    nameTet: 'Zona 3 (Dook)', namePt: 'Zona 3 (Distante)', nameEn: 'Zone 3 (Far)', nameId: 'Zona 3 (Jauh)',
    docRateUsd: '3.50', smallBase2kgUsd: '5.00', extraPerKgUsd: '1.25', cargoBase10kgUsd: '16.00', cargoExtraPerKgUsd: '0.95',
    etaTet: '1 – 2 loron', etaPt: '1 – 2 dias', etaEn: '1 – 2 days', etaId: '1 – 2 hari',
  },
  {
    code: 'ZONE_4',
    nameTet: 'Zona 4 (Espesiál — Tasi)', namePt: 'Zona 4 (Especial — Marítima)', nameEn: 'Zone 4 (Special — Sea)', nameId: 'Zona 4 (Khusus — Laut)',
    docRateUsd: '5.00', smallBase2kgUsd: '6.00', extraPerKgUsd: '1.50', cargoBase10kgUsd: '18.00', cargoExtraPerKgUsd: '1.00',
    etaTet: '2 – 4 loron', etaPt: '2 – 4 dias', etaEn: '2 – 4 days', etaId: '2 – 4 hari',
  },
] as const;

async function seedGeography() {
  console.log('▸ Geography: pricing zones, 14 municipalities, hubs');

  const zoneIds = new Map<string, string>();
  for (const z of ZONES) {
    const data = {
      nameTet: z.nameTet, namePt: z.namePt, nameEn: z.nameEn, nameId: z.nameId,
      docRateUsd: D(z.docRateUsd), smallBase2kgUsd: D(z.smallBase2kgUsd), extraPerKgUsd: D(z.extraPerKgUsd),
      cargoBase10kgUsd: D(z.cargoBase10kgUsd), cargoExtraPerKgUsd: D(z.cargoExtraPerKgUsd),
      etaTet: z.etaTet, etaPt: z.etaPt, etaEn: z.etaEn, etaId: z.etaId,
    };
    const row = await prisma.pricingZone.upsert({
      where: { code: z.code },
      create: { code: z.code, ...data },
      update: keepOrForce(data),
    });
    zoneIds.set(z.code, row.id);
  }
  log(`${ZONES.length} pricing zones`);

  const muniIds = new Map<string, string>();
  for (const m of MUNICIPALITIES) {
    const data = {
      name: m.name,
      mainTown: m.mainTown,
      corridor: m.corridor,
      zoneId: m.zone ? zoneIds.get(m.zone)! : null,
      isSeaRoute: m.isSeaRoute,
      tariffSurchargeUsd: D(m.tariffSurchargeUsd),
    };
    const row = await prisma.municipality.upsert({
      where: { code: m.code },
      create: { code: m.code, ...data },
      // Sea-route flag is a compliance control: always re-asserted, never left to drift.
      update: { ...keepOrForce(data), isSeaRoute: m.isSeaRoute },
    });
    muniIds.set(m.code, row.id);
  }
  log(`${MUNICIPALITIES.length} municipalities`);

  const dili = muniIds.get('DIL')!;
  const hubIds = new Map<string, string>();
  for (const h of HUBS) {
    const data = {
      name: h.name, type: h.type, corridor: h.corridor, municipalityId: dili,
      address: h.address, lat: D(h.lat), lng: D(h.lng),
    };
    const row = await prisma.hub.upsert({
      where: { code: h.code },
      create: { code: h.code, ...data },
      update: keepOrForce(data),
    });
    hubIds.set(h.code, row.id);
  }
  log(`${HUBS.length} hubs (Becora, Taibesi, Tasi Tolu, Porto Díli)`);

  for (const m of MUNICIPALITIES) {
    if (!m.hub) continue;
    await prisma.municipality.update({
      where: { code: m.code },
      data: { servingHubId: hubIds.get(m.hub)! },
    });
  }

  return { zoneIds, muniIds, hubIds };
}

/* -------------------------------------------------------------------------- */
/* 3. Add-on tariffs                                                          */
/* -------------------------------------------------------------------------- */
async function seedAddonTariffs() {
  console.log('▸ Add-on tariffs');
  const courierPct = (ADDON_SPLIT_BPS.partner / 100).toFixed(2);
  const platformPct = (ADDON_SPLIT_BPS.platform / 100).toFixed(2);

  const rows = [
    {
      serviceType: 'MOTOR_PICKUP', feeUsd: '1.50', maxWeightKg: 10, radiusKm: 5,
      labelTet: 'Estafeta motor foti pakote (≤10 kg, ≤5 km)',
      labelPt: 'Recolha por estafeta de mota (≤10 kg, ≤5 km)',
      labelEn: 'Motorbike pick-up (≤10 kg, ≤5 km)',
      labelId: 'Jemput kurir motor (≤10 kg, ≤5 km)',
    },
    {
      serviceType: 'MOTOR_DELIVERY', feeUsd: '1.50', maxWeightKg: 10, radiusKm: 5,
      labelTet: 'Estafeta motor entrega pakote (≤10 kg, ≤5 km)',
      labelPt: 'Entrega por estafeta de mota (≤10 kg, ≤5 km)',
      labelEn: 'Motorbike last-mile delivery (≤10 kg, ≤5 km)',
      labelId: 'Antar kurir motor (≤10 kg, ≤5 km)',
    },
    {
      serviceType: 'CARGO_PICKUP', feeUsd: '5.00', maxWeightKg: 500, radiusKm: 5,
      labelTet: 'Pikap foti karga (>10 kg, área Díli)',
      labelPt: 'Recolha de carga em pick-up (>10 kg, área de Díli)',
      labelEn: 'Pickup-truck cargo pick-up (>10 kg, Dili urban)',
      labelId: 'Jemput kargo pikap (>10 kg, area Dili)',
    },
    {
      serviceType: 'CARGO_DELIVERY', feeUsd: '5.00', maxWeightKg: 500, radiusKm: 5,
      labelTet: 'Pikap entrega karga (>10 kg, área Díli)',
      labelPt: 'Entrega de carga em pick-up (>10 kg, área de Díli)',
      labelEn: 'Pickup-truck cargo delivery (>10 kg, Dili urban)',
      labelId: 'Antar kargo pikap (>10 kg, area Dili)',
    },
  ] as const;

  for (const r of rows) {
    const data = {
      labelTet: r.labelTet, labelPt: r.labelPt, labelEn: r.labelEn, labelId: r.labelId,
      feeUsd: D(r.feeUsd), courierSplitPct: D(courierPct), platformSplitPct: D(platformPct),
      maxWeightKg: r.maxWeightKg, radiusKm: r.radiusKm,
      wholesaleMinParcels: 3, wholesaleFreePickup: false,
    };
    await prisma.addonTariff.upsert({
      where: { serviceType: r.serviceType },
      create: { serviceType: r.serviceType, ...data },
      update: keepOrForce(data),
    });
  }
  log(`${rows.length} add-on tariffs (80% courier / 20% platform)`);
}

/* -------------------------------------------------------------------------- */
/* 4. System settings                                                         */
/* -------------------------------------------------------------------------- */
async function seedSettings() {
  console.log('▸ System settings');
  const settings: Array<[string, Prisma.InputJsonValue, string]> = [
    ['timezone', 'Asia/Dili', 'Business timezone for waybill dates, cut-offs and cron jobs'],
    ['revenue_split_bps', { ...REVENUE_SPLIT_BPS }, 'Base-fee split in basis points (sum = 10000)'],
    ['addon_split_bps', { ...ADDON_SPLIT_BPS }, 'Courier / pickup-truck add-on split'],
    ['bus_capacity', { ...BUS_CAPACITY_DEFAULTS }, 'Max small parcels / master bags per bus trip (DNTT/PNTL safety)'],
    ['storage_policy', { ...STORAGE_POLICY, reminderDays: [...STORAGE_POLICY.reminderDays] }, 'Unclaimed-parcel storage fee & RTS policy'],
    ['insurance', { ...INSURANCE }, 'Optional insurance premium and coverage cap'],
    ['uninsured_liability', { ...UNINSURED_LIABILITY }, 'Limited-liability formula for uninsured parcels'],
    ['claim_cs_approval_limit_usd', '25.00', 'CS_CLAIMS_ADMIN may approve claims up to this amount; above it Finance co-approval is required (ASSUMED — confirm)'],
    ['otp', { length: 6, ttlDays: 15, maxAttempts: 5, lockMinutes: 15 }, 'Pickup OTP policy'],
    ['claim_handover_window_minutes', 60, 'Damage / seal claims on a DELIVERED parcel are only valid this long after hand-over (SOP: claim at hand-over)'],
    ['dest_commission_wallet', 'COMMISSION', 'Wallet that receives the destination agent 15% on delivery: COMMISSION (default) or DEPOSIT'],
    ['pickup_cutoff_local_time', '10:00', 'Pick-up requests before this local time dispatch the same day'],
    ['unclaimed_cron', '0 8 * * *', 'Unclaimed-parcel sweep (Asia/Dili)'],
    ['intake_limits', { maxPhotoBytes: 204800, requiredPhotos: ['OPEN_BOX_CONTENT', 'SEALED_PARCEL'] }, 'Client compression target (<200 KB for 3G) and mandatory intake photos'],
  ];
  for (const [key, value, description] of settings) {
    await prisma.systemSetting.upsert({
      where: { key },
      create: { key, value, description },
      update: keepOrForce({ value, description }),
    });
  }
  log(`${settings.length} settings`);
}

/* -------------------------------------------------------------------------- */
/* 5. WhatsApp templates (11 events × 4 languages = 44)                       */
/* -------------------------------------------------------------------------- */
async function seedTemplates() {
  console.log('▸ WhatsApp notification templates');
  let n = 0;
  for (const eventCode of NOTIFICATION_EVENT_CODES) {
    for (const locale of LOCALES) {
      const lang = toPrismaLanguage(locale);
      const bodyTemplate = WHATSAPP_TEMPLATES[eventCode][locale];
      await prisma.notificationTemplate.upsert({
        where: { eventCode_lang: { eventCode, lang } },
        create: { eventCode, lang, bodyTemplate, isActive: true },
        update: keepOrForce({ bodyTemplate }),
      });
      n++;
    }
  }
  log(`${n} templates (9 tracking states + Day-3/Day-5 reminders × tet/pt/en/id)`);
}

/* -------------------------------------------------------------------------- */
/* 6. System wallets + ledger helper                                          */
/* -------------------------------------------------------------------------- */
const SYSTEM_OWNER = 'SYSTEM';
const SYSTEM_WALLETS = [
  'PLATFORM_REVENUE',
  'PLATFORM_HUB_OPS',
  'CLAIM_ESCROW_RESERVE',
  'INSURANCE_POOL',
  'PENDING_SETTLEMENT',
  'EXTERNAL_CLEARING',
] as const;

async function seedSystemWallets() {
  console.log('▸ System wallets');
  const ids = new Map<string, string>();
  for (const walletType of SYSTEM_WALLETS) {
    const w = await prisma.wallet.upsert({
      where: { ownerType_ownerId_walletType: { ownerType: 'SYSTEM', ownerId: SYSTEM_OWNER, walletType } },
      create: { ownerType: 'SYSTEM', ownerId: SYSTEM_OWNER, walletType },
      update: {},
    });
    ids.set(walletType, w.id);
  }
  log(SYSTEM_WALLETS.join(', '));
  return ids;
}

async function ensureWallet(
  ownerType: 'AGENT' | 'COURIER' | 'FLEET_OWNER' | 'USER',
  ownerId: string,
  walletType: (typeof SYSTEM_WALLETS)[number] | 'DEPOSIT' | 'COMMISSION' | 'FLEET_PAYABLE' | 'COURIER_EARNINGS',
) {
  return prisma.wallet.upsert({
    where: { ownerType_ownerId_walletType: { ownerType, ownerId, walletType } },
    create: { ownerType, ownerId, walletType },
    update: {},
  });
}

/**
 * Minimal double-entry posting used only by the seed (the production LedgerService in
 * Phase 2 generalises this): idempotent, row-locked, balanced, immutable.
 * Debits EXTERNAL_CLEARING, credits the target wallet.
 */
async function postDemoTopUp(args: {
  idempotencyKey: string;
  toWalletId: string;
  clearingWalletId: string;
  amount: string;
  description: string;
}) {
  const amount = D(args.amount);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey: args.idempotencyKey } });
    if (existing) return;

    // Pessimistic lock in a stable order (id) to avoid deadlocks.
    // (ids are bound as text by the driver, so cast to uuid[] explicitly)
    const lockIds = [args.toWalletId, args.clearingWalletId];
    await tx.$queryRaw`SELECT id FROM wallets WHERE id = ANY(${lockIds}::uuid[]) ORDER BY id FOR UPDATE`;

    const to = await tx.wallet.findUniqueOrThrow({ where: { id: args.toWalletId } });
    const clearing = await tx.wallet.findUniqueOrThrow({ where: { id: args.clearingWalletId } });

    const txn = await tx.ledgerTransaction.create({
      data: {
        referenceType: 'DEPOSIT_TOPUP',
        referenceId: 'seed',
        idempotencyKey: args.idempotencyKey,
        description: args.description,
      },
    });

    await tx.ledgerEntry.createMany({
      data: [
        {
          transactionId: txn.id, walletId: clearing.id, entryType: 'DEBIT', referenceType: 'DEPOSIT_TOPUP',
          referenceId: 'seed', amount, balanceBefore: clearing.balance, balanceAfter: clearing.balance.minus(amount),
          description: args.description,
        },
        {
          transactionId: txn.id, walletId: to.id, entryType: 'CREDIT', referenceType: 'DEPOSIT_TOPUP',
          referenceId: 'seed', amount, balanceBefore: to.balance, balanceAfter: to.balance.plus(amount),
          description: args.description,
        },
      ],
    });
    await tx.wallet.update({ where: { id: clearing.id }, data: { balance: { decrement: amount }, version: { increment: 1 } } });
    await tx.wallet.update({ where: { id: to.id }, data: { balance: { increment: amount }, version: { increment: 1 } } });
  });
}

/* -------------------------------------------------------------------------- */
/* 7. Users (Super Admin always; the rest are demo)                           */
/* -------------------------------------------------------------------------- */
interface SeedUser {
  email?: string;
  phone: string;
  fullName: string;
  role: RoleKey;
  lang?: 'TET' | 'PT' | 'EN' | 'ID';
  password?: string;
  pin?: boolean;
}

async function upsertUser(u: SeedUser, roleIds: Record<RoleKey, string>) {
  const [passwordHash, pinHash] = await Promise.all([
    u.password ? argon2.hash(u.password, { type: argon2.argon2id }) : Promise.resolve(null),
    u.pin ? argon2.hash(PIN, { type: argon2.argon2id }) : Promise.resolve(null),
  ]);

  const user = await prisma.user.upsert({
    where: { phone: u.phone },
    create: {
      email: u.email?.toLowerCase(),
      phone: u.phone,
      fullName: u.fullName,
      passwordHash,
      pinHash,
      preferredLang: u.lang ?? 'TET',
      mustChangePassword: IS_PROD,
    },
    update: {},
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: user.id, roleId: roleIds[u.role] } },
    create: { userId: user.id, roleId: roleIds[u.role] },
    update: {},
  });
  return user;
}

/** Inactive technical user: owner of automated records (scheduled payout drafts). It cannot log in. */
async function seedSystemUser() {
  await prisma.user.upsert({
    where: { phone: '+67000000000' },
    create: { phone: '+67000000000', email: 'system@670send.internal', fullName: '670Send System', isActive: false },
    update: {},
  });
}

async function seedSuperAdmin(roleIds: Record<RoleKey, string>) {
  console.log('▸ Bootstrap Super Admin');
  await upsertUser(
    { email: SUPERADMIN_EMAIL, phone: SUPERADMIN_PHONE, fullName: 'Super Admin 670Send', role: 'SUPER_ADMIN', lang: 'TET', password: SUPERADMIN_PASSWORD, pin: true },
    roleIds,
  );
  log(`login: ${SUPERADMIN_EMAIL}`);
}

/* -------------------------------------------------------------------------- */
/* 8. Demo data                                                               */
/* -------------------------------------------------------------------------- */
async function seedDemo(
  roleIds: Record<RoleKey, string>,
  geo: Awaited<ReturnType<typeof seedGeography>>,
  sys: Map<string, string>,
) {
  console.log('▸ Demo data (development only)');

  // --- Backoffice staff -----------------------------------------------------
  const staff: SeedUser[] = [
    { email: 'ops@670send.test', phone: '+67077000002', fullName: 'Ops Hub Admin (Demo)', role: 'OPS_HUB_ADMIN', lang: 'PT', password: PASSWORD, pin: true },
    { email: 'finance@670send.test', phone: '+67077000003', fullName: 'Finance Admin (Demo)', role: 'FINANCE_ADMIN', lang: 'EN', password: PASSWORD, pin: true },
    { email: 'cs@670send.test', phone: '+67077000004', fullName: 'CS & Claims Admin (Demo)', role: 'CS_CLAIMS_ADMIN', lang: 'ID', password: PASSWORD, pin: true },
  ];
  for (const s of staff) {
    await upsertUser(s, roleIds);
    log(`${s.role.padEnd(16)} ${s.email}`);
  }

  // --- Agents (670Link kiosks) ----------------------------------------------
  const agents = [
    {
      user: { phone: '+67077100001', fullName: 'Maria da Costa (Demo)', role: 'AGENT' as const, pin: true },
      muni: 'DIL', agentCode: 'AG-DIL-001', kioskName: 'Kios 670Link Colmera',
      address: 'Rua de Colmera, Díli', lat: '-8.556000', lng: '125.570000', hours: '08:00–19:00 (Seg–Sab)',
      ext: '670LINK-DEMO-0001',
    },
    {
      user: { phone: '+67077100002', fullName: 'José Guterres (Demo)', role: 'AGENT' as const, pin: true },
      muni: 'BCU', agentCode: 'AG-BCU-001', kioskName: 'Kios 670Link Baucau Vila',
      address: 'Baucau Vila, Baucau', lat: '-8.469000', lng: '126.456000', hours: '08:00–18:00 (Seg–Sab)',
      ext: '670LINK-DEMO-0002',
    },
  ];
  for (const a of agents) {
    const user = await upsertUser(a.user, roleIds);
    const agent = await prisma.agent.upsert({
      where: { agentCode: a.agentCode },
      create: {
        userId: user.id, municipalityId: geo.muniIds.get(a.muni)!, agentCode: a.agentCode,
        kioskName: a.kioskName, address: a.address, lat: D(a.lat), lng: D(a.lng), openingHours: a.hours,
        hasDigitalScale: true, hasSecureStorage: true, adendumSignedAt: new Date(),
        external670LinkAgentId: a.ext, status: 'ACTIVE',
      },
      update: {},
    });
    const deposit = await ensureWallet('AGENT', agent.id, 'DEPOSIT');
    await ensureWallet('AGENT', agent.id, 'COMMISSION');
    await postDemoTopUp({
      idempotencyKey: `seed:topup:${a.agentCode}`,
      toWalletId: deposit.id,
      clearingWalletId: sys.get('EXTERNAL_CLEARING')!,
      amount: '100.0000',
      description: `Demo opening deposit — ${a.agentCode}`,
    });
    log(`AGENT ${a.agentCode} ${a.kioskName} (deposit $100.00)`);
  }

  // --- Courier --------------------------------------------------------------
  {
    const user = await upsertUser(
      { phone: '+67077200001', fullName: 'Domingos Pereira (Demo)', role: 'COURIER', pin: true },
      roleIds,
    );
    const courier = await prisma.courier.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id, hubId: geo.hubIds.get('HUB_BECORA')!, municipalityId: geo.muniIds.get('DIL')!,
        vehicleType: 'MOTORBIKE', plateNumber: 'A-DEMO-01-TL', isAvailable: true, status: 'ACTIVE',
      },
      update: {},
    });
    const deposit = await ensureWallet('COURIER', courier.id, 'DEPOSIT');
    await ensureWallet('COURIER', courier.id, 'COURIER_EARNINGS');
    await postDemoTopUp({
      idempotencyKey: 'seed:topup:COURIER-DEMO-01',
      toWalletId: deposit.id,
      clearingWalletId: sys.get('EXTERNAL_CLEARING')!,
      amount: '20.0000',
      description: 'Demo opening float — courier',
    });
    log('COURIER Domingos Pereira (Becora, motorbike)');
  }

  // --- Bus fleet partner + vehicle + driver ----------------------------------
  {
    const owner = await upsertUser(
      { email: 'fleet@670send.test', phone: '+67077300001', fullName: 'Antónia Ximenes (Demo)', role: 'FLEET_OWNER', lang: 'TET', password: PASSWORD, pin: true },
      roleIds,
    );
    const oneYear = new Date();
    oneYear.setFullYear(oneYear.getFullYear() + 1);

    const partner = await prisma.fleetPartner.upsert({
      where: { mouNumber: 'MOU-670SEND-DEMO-001' },
      create: {
        ownerUserId: owner.id, companyName: 'Transporte Lorosae Express, Lda. (DEMO)',
        serveRegNo: 'SERVE-DEMO-0001', mouNumber: 'MOU-670SEND-DEMO-001', mouSignedAt: new Date(),
        mouValidUntil: oneYear, payoutCycle: 'WEEKLY', payoutChannel: 'BNCTL',
        bankAccountDetails: { bank: 'BNCTL', accountName: 'DEMO ONLY', accountNo: '0000000000' },
        status: 'ACTIVE',
      },
      update: {},
    });
    await ensureWallet('FLEET_OWNER', partner.id, 'FLEET_PAYABLE');

    await prisma.vehicle.upsert({
      where: { plateNumber: 'A.12-345 TL' },
      create: {
        fleetPartnerId: partner.id, plateNumber: 'A.12-345 TL', vehicleType: 'BUS_PASSENGER',
        routeCorridor: 'EAST', maxParcelSlots: BUS_CAPACITY_DEFAULTS.maxSmallParcels,
        dnttPermitNo: 'DNTT-DEMO-0001', dnttPermitExpiry: oneYear, kirExpiry: oneYear, isActive: true,
      },
      update: {},
    });

    const driverUser = await upsertUser(
      { phone: '+67077300002', fullName: 'Armando Soares (Demo)', role: 'DRIVER', pin: true },
      roleIds,
    );
    await prisma.driver.upsert({
      where: { userId: driverUser.id },
      create: {
        userId: driverUser.id, fleetPartnerId: partner.id, licenseNumber: 'KD-DEMO-0001',
        licenseExpiry: oneYear, phone: '+67077300002', isActive: true,
      },
      update: {},
    });
    log('FLEET Transporte Lorosae Express (Dili–Baucau bus A.12-345 TL, driver Armando Soares)');
  }
}

/* -------------------------------------------------------------------------- */
/* Main                                                                       */
/* -------------------------------------------------------------------------- */
async function main() {
  console.log(`\n670Send seed — NODE_ENV=${process.env.NODE_ENV ?? 'development'}, demo=${SEED_DEMO}, force=${FORCE}\n`);
  assertSafeSecrets();

  const roleIds = await seedRbac();
  const geo = await seedGeography();
  await seedAddonTariffs();
  await seedSettings();
  await seedTemplates();
  const sys = await seedSystemWallets();
  await seedSystemUser();
  await seedSuperAdmin(roleIds);
  if (SEED_DEMO) await seedDemo(roleIds, geo, sys);
  else console.log('▸ Demo data skipped');

  console.log('\n✔ Seed complete. Passwords / PIN come from SEED_* variables in your .env (never printed).\n');
}

main()
  .catch((err) => {
    console.error('\n✖ Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

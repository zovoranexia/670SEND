import { Injectable } from '@nestjs/common';
import { Prisma, type CourierVehicleType, type FleetPayoutChannel, type PartnerStatus, type PayoutCycle, type RouteCorridor, type VehicleType } from '@prisma/client';
import { hasPermission, toPrismaLanguage, type Locale } from '@670send/types';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { AppException, Err } from '../common/errors';
import { FieldCrypto } from '../common/field-crypto';
import { LedgerService } from '../ledger/ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import type { Actor } from '../rbac/actor';
import { ActorService } from '../rbac/actor.service';

const usd = (d: Prisma.Decimal) => d.toFixed(4);
const day = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);
const today = () => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()));
};

interface FieldUserInput {
  fullName: string;
  phone: string;
  email?: string;
  pin: string;
  password?: string;
  preferredLang: Locale;
}

export interface BankDetails {
  bank: string;
  accountName: string;
  accountNo: string;
}

/**
 * Partner & compliance directory (agents, couriers, fleet partners, vehicles, drivers).
 * Activation is gated by the SOP's compliance requirements, and expiring MoUs / DNTT permits / KIR /
 * driving licences / missing addenda surface in `alerts()`.
 */
@Injectable()
export class DirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly crypto: FieldCrypto,
    private readonly actors: ActorService,
    private readonly ledger: LedgerService,
  ) {}

  /* ---------------------------------- shared helpers ---------------------------------- */

  private async createFieldUser(tx: Prisma.TransactionClient, input: FieldUserInput, roleKey: string, actorId: string) {
    const dup = await tx.user.findFirst({ where: { OR: [{ phone: input.phone }, ...(input.email ? [{ email: input.email.toLowerCase() }] : [])] }, select: { id: true } });
    if (dup) throw new AppException('user_exists', 409);
    const role = await tx.role.findUniqueOrThrow({ where: { key: roleKey } });
    return tx.user.create({
      data: {
        fullName: input.fullName,
        phone: input.phone,
        email: input.email?.toLowerCase(),
        preferredLang: toPrismaLanguage(input.preferredLang),
        pinHash: await this.passwords.hash(input.pin),
        passwordHash: input.password ? await this.passwords.hash(input.password) : null,
        mustChangePassword: Boolean(input.password),
        userRoles: { create: [{ roleId: role.id, assignedBy: actorId }] },
      },
    });
  }

  private async nextCounter(tx: Prisma.TransactionClient, kind: string, scope: string): Promise<number> {
    const rows = await tx.$queryRaw<Array<{ last_value: number }>>`
      INSERT INTO waybill_sequences (origin_code, dest_code, date_key, last_value, updated_at)
      VALUES (${kind}, ${scope}, '000000', 1, now())
      ON CONFLICT (origin_code, dest_code, date_key)
      DO UPDATE SET last_value = waybill_sequences.last_value + 1, updated_at = now()
      RETURNING last_value`;
    return rows[0]!.last_value;
  }

  /* ================================ field apps (PWA) ================================ */

  /** The signed-in field user's working context. Back-office staff have none (403). */
  async fieldProfile(actor: Actor) {
    if (actor.agentId) {
      const a = await this.prisma.agent.findUniqueOrThrow({ where: { id: actor.agentId }, include: { municipality: { select: { code: true, name: true } } } });
      return { kind: 'AGENT' as const, agentId: a.id, agentCode: a.agentCode, kioskName: a.kioskName, address: a.address, openingHours: a.openingHours, municipality: a.municipality };
    }
    if (actor.courierId) {
      const c = await this.prisma.courier.findUniqueOrThrow({ where: { id: actor.courierId }, include: { municipality: { select: { code: true, name: true } }, hub: { select: { code: true, name: true } } } });
      return { kind: 'COURIER' as const, courierId: c.id, isAvailable: c.isAvailable, vehicleType: c.vehicleType, municipality: c.municipality, hub: c.hub };
    }
    if (actor.driverId) {
      const d = await this.prisma.driver.findUniqueOrThrow({ where: { id: actor.driverId }, include: { fleetPartner: { select: { id: true, companyName: true } } } });
      return { kind: 'DRIVER' as const, driverId: d.id, fleetPartner: d.fleetPartner };
    }
    if (actor.fleetPartnerId) {
      const p = await this.prisma.fleetPartner.findUniqueOrThrow({ where: { id: actor.fleetPartnerId }, select: { id: true, companyName: true } });
      return { kind: 'FLEET_OWNER' as const, fleetPartnerId: p.id, companyName: p.companyName };
    }
    throw Err.forbidden();
  }

  /** Active kiosks of one municipality: enough to choose a destination, nothing personal. */
  async listKiosks(municipalityCode: string) {
    const muni = await this.prisma.municipality.findUnique({ where: { code: municipalityCode } });
    if (!muni) throw Err.validation([{ path: 'municipalityCode', message: 'errors.validation_failed' }]);
    const rows = await this.prisma.agent.findMany({
      where: { municipalityId: muni.id, status: 'ACTIVE', deletedAt: null },
      orderBy: { kioskName: 'asc' },
      select: { id: true, agentCode: true, kioskName: true, address: true, openingHours: true },
    });
    return rows;
  }

  /* ====================================== agents ====================================== */

  async createAgent(
    actor: Actor,
    input: FieldUserInput & { municipalityCode: string; kioskName: string; address: string; lat?: number; lng?: number; openingHours?: string; hasDigitalScale: boolean; hasSecureStorage: boolean; external670LinkAgentId?: string },
  ) {
    const muni = await this.prisma.municipality.findUnique({ where: { code: input.municipalityCode } });
    if (!muni) throw Err.validation([{ path: 'municipalityCode', message: 'errors.validation_failed' }]);
    const agent = await this.prisma.$transaction(async (tx) => {
      const user = await this.createFieldUser(tx, input, 'AGENT', actor.id);
      // The counter only knows codes it issued itself; seeded / imported kiosks may already hold low numbers.
      let agentCode: string;
      do {
        const n = await this.nextCounter(tx, 'AGT', muni.code);
        agentCode = `AG-${muni.code}-${String(n).padStart(3, '0')}`;
      } while (await tx.agent.findUnique({ where: { agentCode }, select: { id: true } }));
      const a = await tx.agent.create({
        data: {
          userId: user.id,
          municipalityId: muni.id,
          agentCode,
          kioskName: input.kioskName,
          address: input.address,
          lat: input.lat,
          lng: input.lng,
          openingHours: input.openingHours,
          hasDigitalScale: input.hasDigitalScale,
          hasSecureStorage: input.hasSecureStorage,
          external670LinkAgentId: input.external670LinkAgentId,
          status: 'PENDING',
        },
      });
      await this.audit.writeInTx(tx, { action: 'AGENT_CREATED', entityType: 'agent', entityId: a.id, after: { agentCode: a.agentCode, kioskName: a.kioskName, municipality: muni.code } });
      return a;
    });
    return this.agentDto(agent.id);
  }

  async agentDto(id: string) {
    const a = await this.prisma.agent.findFirst({ where: { id, deletedAt: null }, include: { municipality: { select: { code: true, name: true } }, user: { select: { fullName: true, phone: true } } } });
    if (!a) throw Err.notFound();
    const deposit = await this.prisma.wallet.findUnique({ where: { ownerType_ownerId_walletType: { ownerType: 'AGENT', ownerId: a.id, walletType: 'DEPOSIT' } } });
    return {
      id: a.id,
      agentCode: a.agentCode,
      kioskName: a.kioskName,
      status: a.status,
      statusReason: a.statusReason,
      municipality: a.municipality,
      address: a.address,
      lat: a.lat && Number(a.lat),
      lng: a.lng && Number(a.lng),
      openingHours: a.openingHours,
      hasDigitalScale: a.hasDigitalScale,
      hasSecureStorage: a.hasSecureStorage,
      adendumSignedAt: a.adendumSignedAt,
      external670LinkAgentId: a.external670LinkAgentId,
      operator: a.user,
      depositBalance: deposit ? usd(deposit.balance) : '0.0000',
      createdAt: a.createdAt,
    };
  }

  async listAgents(q: { status?: PartnerStatus; municipalityCode?: string; limit: number }) {
    const rows = await this.prisma.agent.findMany({
      where: { deletedAt: null, ...(q.status ? { status: q.status } : {}), ...(q.municipalityCode ? { municipality: { code: q.municipalityCode } } : {}) },
      orderBy: [{ agentCode: 'asc' }],
      take: q.limit,
      select: { id: true },
    });
    return Promise.all(rows.map((r) => this.agentDto(r.id)));
  }

  async updateAgent(actor: Actor, id: string, input: Partial<{ kioskName: string; address: string; lat: number; lng: number; openingHours: string; hasDigitalScale: boolean; hasSecureStorage: boolean; external670LinkAgentId: string }>) {
    const before = await this.agentDto(id);
    await this.prisma.agent.update({ where: { id }, data: input });
    await this.audit.write({ action: 'AGENT_UPDATED', entityType: 'agent', entityId: id, before, after: input, actorId: actor.id });
    return this.agentDto(id);
  }

  /** Records the signed 670Send adendum on the 670Link agreement. */
  async signAdendum(actor: Actor, id: string) {
    await this.agentDto(id);
    await this.prisma.agent.update({ where: { id }, data: { adendumSignedAt: new Date() } });
    await this.audit.write({ action: 'AGENT_ADENDUM_SIGNED', entityType: 'agent', entityId: id, actorId: actor.id });
    return this.agentDto(id);
  }

  /**
   * Activation needs the minimum kiosk standard of the adendum: a signed adendum, a digital scale and
   * secure (lockable) storage. Suspension / termination need a recorded reason and take effect immediately.
   */
  async setAgentStatus(actor: Actor, id: string, input: { status: PartnerStatus; reason?: string }) {
    const a = await this.prisma.agent.findFirst({ where: { id, deletedAt: null } });
    if (!a) throw Err.notFound();
    if (input.status === 'ACTIVE' && (!a.adendumSignedAt || !a.hasDigitalScale || !a.hasSecureStorage)) throw new AppException('agent_not_compliant', 422);
    if ((input.status === 'SUSPENDED' || input.status === 'TERMINATED') && !input.reason) throw Err.validation([{ path: 'reason', message: 'errors.validation_failed' }]);
    await this.prisma.agent.update({ where: { id }, data: { status: input.status, statusReason: input.reason ?? null } });
    this.actors.invalidate(a.userId);
    await this.audit.write({ action: 'AGENT_STATUS_CHANGED', entityType: 'agent', entityId: id, before: { status: a.status }, after: input, actorId: actor.id });
    return this.agentDto(id);
  }

  /* ===================================== couriers ===================================== */

  async createCourier(actor: Actor, input: FieldUserInput & { municipalityCode: string; hubCode?: string; vehicleType: CourierVehicleType; plateNumber?: string }) {
    const [muni, hub] = await Promise.all([
      this.prisma.municipality.findUnique({ where: { code: input.municipalityCode } }),
      input.hubCode ? this.prisma.hub.findUnique({ where: { code: input.hubCode } }) : Promise.resolve(null),
    ]);
    if (!muni || (input.hubCode && !hub)) throw Err.validation([{ path: 'municipalityCode', message: 'errors.validation_failed' }]);
    const courier = await this.prisma.$transaction(async (tx) => {
      const user = await this.createFieldUser(tx, input, 'COURIER', actor.id);
      const c = await tx.courier.create({
        data: { userId: user.id, municipalityId: muni.id, hubId: hub?.id, vehicleType: input.vehicleType, plateNumber: input.plateNumber, status: 'ACTIVE', isAvailable: true },
      });
      await this.audit.writeInTx(tx, { action: 'COURIER_CREATED', entityType: 'courier', entityId: c.id, after: { name: input.fullName, municipality: muni.code } });
      return c;
    });
    return this.courierDto(courier.id);
  }

  async courierDto(id: string) {
    const c = await this.prisma.courier.findFirst({ where: { id, deletedAt: null }, include: { user: { select: { fullName: true, phone: true } }, municipality: { select: { code: true, name: true } }, hub: { select: { code: true } } } });
    if (!c) throw Err.notFound();
    const wallets = await this.prisma.wallet.findMany({ where: { ownerType: 'COURIER', ownerId: id } });
    const bal = (t: string) => usd(wallets.find((w) => w.walletType === t)?.balance ?? new Prisma.Decimal(0));
    return {
      id: c.id,
      name: c.user.fullName,
      phone: c.user.phone,
      status: c.status,
      isAvailable: c.isAvailable,
      vehicleType: c.vehicleType,
      plateNumber: c.plateNumber,
      municipality: c.municipality,
      hub: c.hub?.code ?? null,
      depositBalance: bal('DEPOSIT'),
      earningsBalance: bal('COURIER_EARNINGS'),
    };
  }

  async listCouriers(q: { municipalityCode?: string; limit: number }) {
    const rows = await this.prisma.courier.findMany({ where: { deletedAt: null, ...(q.municipalityCode ? { municipality: { code: q.municipalityCode } } : {}) }, take: q.limit, orderBy: { createdAt: 'desc' }, select: { id: true } });
    return Promise.all(rows.map((r) => this.courierDto(r.id)));
  }

  async updateCourier(actor: Actor, id: string, input: Partial<{ hubCode: string; vehicleType: CourierVehicleType; plateNumber: string; isAvailable: boolean; status: PartnerStatus }>) {
    const c = await this.prisma.courier.findFirst({ where: { id, deletedAt: null } });
    if (!c) throw Err.notFound();
    let hubId: string | undefined;
    if (input.hubCode) {
      const hub = await this.prisma.hub.findUnique({ where: { code: input.hubCode } });
      if (!hub) throw Err.validation([{ path: 'hubCode', message: 'errors.validation_failed' }]);
      hubId = hub.id;
    }
    await this.prisma.courier.update({ where: { id }, data: { ...(hubId ? { hubId } : {}), ...(input.vehicleType ? { vehicleType: input.vehicleType } : {}), ...(input.plateNumber ? { plateNumber: input.plateNumber } : {}), ...(input.isAvailable === undefined ? {} : { isAvailable: input.isAvailable }), ...(input.status ? { status: input.status } : {}) } });
    this.actors.invalidate(c.userId);
    await this.audit.write({ action: 'COURIER_UPDATED', entityType: 'courier', entityId: id, after: input, actorId: actor.id });
    return this.courierDto(id);
  }

  /** A courier toggles their own availability (off shift / on shift). */
  async setOwnAvailability(actor: Actor, available: boolean) {
    if (!actor.courierId) throw Err.forbidden();
    await this.prisma.courier.update({ where: { id: actor.courierId }, data: { isAvailable: available, lastSeenAt: new Date() } });
    return this.courierDto(actor.courierId);
  }

  /* ================================== fleet partners ================================== */

  async createFleetPartner(
    actor: Actor,
    input: FieldUserInput & { companyName: string; serveRegNo?: string; mouNumber?: string; mouSignedAt?: Date; mouValidUntil?: Date; payoutCycle: PayoutCycle; payoutChannel: FleetPayoutChannel; bank?: BankDetails },
  ) {
    const partner = await this.prisma.$transaction(async (tx) => {
      const owner = await this.createFieldUser(tx, input, 'FLEET_OWNER', actor.id);
      const p = await tx.fleetPartner.create({
        data: {
          ownerUserId: owner.id,
          companyName: input.companyName,
          serveRegNo: input.serveRegNo,
          mouNumber: input.mouNumber,
          mouSignedAt: input.mouSignedAt,
          mouValidUntil: input.mouValidUntil,
          payoutCycle: input.payoutCycle,
          payoutChannel: input.payoutChannel,
          bankAccountDetails: input.bank ? ({ enc: this.crypto.encrypt(JSON.stringify(input.bank)) } as Prisma.InputJsonObject) : undefined,
          status: 'PENDING',
        },
      });
      await this.audit.writeInTx(tx, { action: 'FLEET_PARTNER_CREATED', entityType: 'fleet_partner', entityId: p.id, after: { companyName: p.companyName, mouNumber: p.mouNumber } });
      return p;
    });
    return this.partnerDto(partner.id);
  }

  async partnerDto(id: string) {
    const p = await this.prisma.fleetPartner.findFirst({
      where: { id, deletedAt: null },
      include: { owner: { select: { fullName: true, phone: true, email: true } }, _count: { select: { vehicles: true, drivers: true } } },
    });
    if (!p) throw Err.notFound();
    const bank = p.bankAccountDetails as { enc?: string } | null;
    let bankMasked: { bank: string; accountNoLast4: string } | null = null;
    if (bank?.enc) {
      const d = JSON.parse(this.crypto.decrypt(bank.enc)) as BankDetails;
      bankMasked = { bank: d.bank, accountNoLast4: d.accountNo.slice(-4) }; // the full number never leaves in a list / detail
    }
    return {
      id: p.id,
      companyName: p.companyName,
      status: p.status,
      statusReason: p.statusReason,
      serveRegNo: p.serveRegNo,
      mou: { number: p.mouNumber, signedAt: day(p.mouSignedAt), validUntil: day(p.mouValidUntil), autoRenew: p.mouAutoRenew, expired: !p.mouValidUntil || p.mouValidUntil < today() },
      payoutCycle: p.payoutCycle,
      payoutChannel: p.payoutChannel,
      bank: bankMasked,
      owner: p.owner,
      vehicleCount: p._count.vehicles,
      driverCount: p._count.drivers,
    };
  }

  async listFleetPartners(q: { status?: PartnerStatus; limit: number }) {
    const rows = await this.prisma.fleetPartner.findMany({ where: { deletedAt: null, ...(q.status ? { status: q.status } : {}) }, take: q.limit, orderBy: { companyName: 'asc' }, select: { id: true } });
    return Promise.all(rows.map((r) => this.partnerDto(r.id)));
  }

  async updateFleetPartner(actor: Actor, id: string, input: Partial<{ companyName: string; serveRegNo: string; payoutCycle: PayoutCycle; payoutChannel: FleetPayoutChannel; mouAutoRenew: boolean }>) {
    const before = await this.partnerDto(id);
    await this.prisma.fleetPartner.update({ where: { id }, data: input });
    await this.audit.write({ action: 'FLEET_PARTNER_UPDATED', entityType: 'fleet_partner', entityId: id, before, after: input, actorId: actor.id });
    return this.partnerDto(id);
  }

  async renewMou(actor: Actor, id: string, input: { mouNumber?: string; mouSignedAt?: Date; mouValidUntil: Date; mouDocumentUrl?: string }) {
    if (input.mouValidUntil <= new Date()) throw Err.validation([{ path: 'mouValidUntil', message: 'errors.validation_failed' }]);
    const before = await this.partnerDto(id);
    await this.prisma.fleetPartner.update({ where: { id }, data: { mouValidUntil: input.mouValidUntil, mouSignedAt: input.mouSignedAt, mouDocumentUrl: input.mouDocumentUrl, ...(input.mouNumber ? { mouNumber: input.mouNumber } : {}) } });
    await this.audit.write({ action: 'FLEET_MOU_RENEWED', entityType: 'fleet_partner', entityId: id, before: before.mou, after: { validUntil: day(input.mouValidUntil), number: input.mouNumber }, actorId: actor.id });
    return this.partnerDto(id);
  }

  /** Bank / MOSAN details are encrypted at rest (AES-GCM). */
  async setBankDetails(actor: Actor, id: string, bank: BankDetails) {
    await this.partnerDto(id);
    await this.prisma.fleetPartner.update({ where: { id }, data: { bankAccountDetails: { enc: this.crypto.encrypt(JSON.stringify(bank)) } } });
    await this.audit.write({ action: 'FLEET_BANK_DETAILS_SET', entityType: 'fleet_partner', entityId: id, actorId: actor.id }); // never the numbers themselves
    return this.partnerDto(id);
  }

  /** Full details for a payout run — every read is audited. */
  async revealBankDetails(actor: Actor, id: string): Promise<BankDetails> {
    const p = await this.prisma.fleetPartner.findFirst({ where: { id, deletedAt: null } });
    const enc = (p?.bankAccountDetails as { enc?: string } | null)?.enc;
    if (!p || !enc) throw Err.notFound();
    await this.audit.write({ action: 'FLEET_BANK_DETAILS_REVEALED', entityType: 'fleet_partner', entityId: id, actorId: actor.id });
    return JSON.parse(this.crypto.decrypt(enc)) as BankDetails;
  }

  /** Activation needs an in-date MoU, a MoU number and payout details; suspension needs a reason. */
  async setFleetStatus(actor: Actor, id: string, input: { status: PartnerStatus; reason?: string }) {
    const p = await this.prisma.fleetPartner.findFirst({ where: { id, deletedAt: null } });
    if (!p) throw Err.notFound();
    if (input.status === 'ACTIVE' && (!p.mouNumber || !p.mouValidUntil || p.mouValidUntil < today() || !p.bankAccountDetails)) throw new AppException('fleet_not_compliant', 422);
    if ((input.status === 'SUSPENDED' || input.status === 'TERMINATED') && !input.reason) throw Err.validation([{ path: 'reason', message: 'errors.validation_failed' }]);
    await this.prisma.fleetPartner.update({ where: { id }, data: { status: input.status, statusReason: input.reason ?? null } });
    this.actors.invalidate(p.ownerUserId);
    await this.audit.write({ action: 'FLEET_STATUS_CHANGED', entityType: 'fleet_partner', entityId: id, before: { status: p.status }, after: input, actorId: actor.id });
    return this.partnerDto(id);
  }

  /* ============================= vehicles & drivers (fleet) ============================= */

  /** Ops may touch any fleet; a fleet owner only their own company. */
  private assertFleetAccess(actor: Actor, partnerId: string, manageAny: 'vehicles:manage' | 'drivers:manage'): void {
    if (hasPermission(actor.permissions, manageAny)) return;
    if (actor.fleetPartnerId === partnerId && !actor.driverId) return;
    throw Err.notFound();
  }

  async createVehicle(actor: Actor, input: { fleetPartnerId: string; plateNumber: string; vehicleType: VehicleType; routeCorridor: RouteCorridor; maxParcelSlots?: number; dnttPermitNo?: string; dnttPermitExpiry?: Date; kirExpiry?: Date }) {
    this.assertFleetAccess(actor, input.fleetPartnerId, 'vehicles:manage');
    await this.partnerDto(input.fleetPartnerId);
    const exists = await this.prisma.vehicle.findUnique({ where: { plateNumber: input.plateNumber } });
    if (exists) throw new AppException('user_exists', 409);
    const v = await this.prisma.vehicle.create({
      data: {
        fleetPartnerId: input.fleetPartnerId,
        plateNumber: input.plateNumber,
        vehicleType: input.vehicleType,
        routeCorridor: input.routeCorridor,
        maxParcelSlots: input.maxParcelSlots ?? 20,
        dnttPermitNo: input.dnttPermitNo,
        dnttPermitExpiry: input.dnttPermitExpiry,
        kirExpiry: input.kirExpiry,
        isActive: false, // nothing can be manifested until Ops VERIFY the permits
      },
    });
    await this.audit.write({ action: 'VEHICLE_CREATED', entityType: 'vehicle', entityId: v.id, after: { plate: v.plateNumber, type: v.vehicleType }, actorId: actor.id });
    return this.vehicleDto(v.id);
  }

  async vehicleDto(id: string) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, deletedAt: null }, include: { fleetPartner: { select: { id: true, companyName: true } } } });
    if (!v) throw Err.notFound();
    return {
      id: v.id,
      plateNumber: v.plateNumber,
      type: v.vehicleType,
      corridor: v.routeCorridor,
      maxParcelSlots: v.maxParcelSlots,
      dnttPermitNo: v.dnttPermitNo,
      dnttPermitExpiry: day(v.dnttPermitExpiry),
      kirExpiry: day(v.kirExpiry),
      permitsValid: !!v.dnttPermitExpiry && v.dnttPermitExpiry >= today() && !!v.kirExpiry && v.kirExpiry >= today(),
      isActive: v.isActive,
      fleetPartner: v.fleetPartner,
    };
  }

  async listVehicles(actor: Actor, q: { fleetPartnerId?: string }) {
    const all = hasPermission(actor.permissions, 'vehicles:read');
    const partnerId = all ? q.fleetPartnerId : actor.fleetPartnerId;
    if (!all && !partnerId) throw Err.forbidden();
    const rows = await this.prisma.vehicle.findMany({ where: { deletedAt: null, ...(partnerId ? { fleetPartnerId: partnerId } : {}) }, select: { id: true }, orderBy: { plateNumber: 'asc' }, take: 200 });
    return Promise.all(rows.map((r) => this.vehicleDto(r.id)));
  }

  async updateVehiclePermits(actor: Actor, id: string, input: Partial<{ dnttPermitNo: string; dnttPermitExpiry: Date; kirExpiry: Date; maxParcelSlots: number }>) {
    const v = await this.prisma.vehicle.findFirst({ where: { id, deletedAt: null } });
    if (!v) throw Err.notFound();
    this.assertFleetAccess(actor, v.fleetPartnerId, 'vehicles:manage');
    // An owner changing permit data sends the vehicle back to verification; Ops edits keep their own verdict.
    const reverify = !hasPermission(actor.permissions, 'vehicles:manage');
    await this.prisma.vehicle.update({ where: { id }, data: { ...input, ...(reverify ? { isActive: false } : {}) } });
    await this.audit.write({ action: 'VEHICLE_PERMITS_UPDATED', entityType: 'vehicle', entityId: id, after: input, actorId: actor.id });
    return this.vehicleDto(id);
  }

  /** Ops verification: only a vehicle with in-date DNTT and KIR can be activated. */
  async setVehicleActive(actor: Actor, id: string, active: boolean) {
    const dto = await this.vehicleDto(id);
    if (active && !dto.permitsValid) throw new AppException('vehicle_permit_expired', 422);
    await this.prisma.vehicle.update({ where: { id }, data: { isActive: active } });
    await this.audit.write({ action: active ? 'VEHICLE_VERIFIED' : 'VEHICLE_DEACTIVATED', entityType: 'vehicle', entityId: id, actorId: actor.id });
    return this.vehicleDto(id);
  }

  async createDriver(actor: Actor, input: FieldUserInput & { fleetPartnerId: string; licenseNumber: string; licenseExpiry?: Date }) {
    this.assertFleetAccess(actor, input.fleetPartnerId, 'drivers:manage');
    await this.partnerDto(input.fleetPartnerId);
    const driver = await this.prisma.$transaction(async (tx) => {
      const user = await this.createFieldUser(tx, input, 'DRIVER', actor.id);
      const d = await tx.driver.create({ data: { userId: user.id, fleetPartnerId: input.fleetPartnerId, licenseNumber: input.licenseNumber, licenseExpiry: input.licenseExpiry, phone: input.phone, isActive: false } });
      await this.audit.writeInTx(tx, { action: 'DRIVER_CREATED', entityType: 'driver', entityId: d.id, after: { name: input.fullName, license: input.licenseNumber } });
      return d;
    });
    return this.driverDto(driver.id);
  }

  async driverDto(id: string) {
    const d = await this.prisma.driver.findFirst({ where: { id, deletedAt: null }, include: { user: { select: { fullName: true } }, fleetPartner: { select: { id: true, companyName: true } } } });
    if (!d) throw Err.notFound();
    return {
      id: d.id,
      name: d.user.fullName,
      phone: d.phone,
      licenseNumber: d.licenseNumber,
      licenseExpiry: day(d.licenseExpiry),
      licenseValid: !!d.licenseExpiry && d.licenseExpiry >= today(),
      isActive: d.isActive,
      fleetPartner: d.fleetPartner,
    };
  }

  async listDrivers(actor: Actor, q: { fleetPartnerId?: string }) {
    const all = hasPermission(actor.permissions, 'drivers:read');
    const partnerId = all ? q.fleetPartnerId : actor.fleetPartnerId;
    if (!all && !partnerId) throw Err.forbidden();
    const rows = await this.prisma.driver.findMany({ where: { deletedAt: null, ...(partnerId ? { fleetPartnerId: partnerId } : {}) }, select: { id: true }, take: 200 });
    return Promise.all(rows.map((r) => this.driverDto(r.id)));
  }

  async updateDriverLicense(actor: Actor, id: string, input: { licenseNumber?: string; licenseExpiry?: Date }) {
    const d = await this.prisma.driver.findFirst({ where: { id, deletedAt: null } });
    if (!d) throw Err.notFound();
    this.assertFleetAccess(actor, d.fleetPartnerId, 'drivers:manage');
    const reverify = !hasPermission(actor.permissions, 'drivers:manage');
    await this.prisma.driver.update({ where: { id }, data: { ...input, ...(reverify ? { isActive: false } : {}) } });
    this.actors.invalidate(d.userId);
    await this.audit.write({ action: 'DRIVER_LICENSE_UPDATED', entityType: 'driver', entityId: id, after: input, actorId: actor.id });
    return this.driverDto(id);
  }

  async setDriverActive(actor: Actor, id: string, active: boolean) {
    const dto = await this.driverDto(id);
    if (active && !dto.licenseValid) throw new AppException('driver_license_expired', 422);
    const d = await this.prisma.driver.update({ where: { id }, data: { isActive: active } });
    this.actors.invalidate(d.userId);
    await this.audit.write({ action: active ? 'DRIVER_VERIFIED' : 'DRIVER_DEACTIVATED', entityType: 'driver', entityId: id, actorId: actor.id });
    return this.driverDto(id);
  }

  /** The fleet owner's own company overview. */
  async myFleet(actor: Actor) {
    if (!actor.fleetPartnerId || actor.driverId) throw Err.forbidden();
    const [partner, wallet] = await Promise.all([this.partnerDto(actor.fleetPartnerId), this.ledger.balanceOf({ ownerType: 'FLEET_OWNER', ownerId: actor.fleetPartnerId, walletType: 'FLEET_PAYABLE' })]);
    return { ...partner, bank: undefined, payableBalance: wallet.balance.toFixed(4) };
  }

  /* ==================================== compliance ==================================== */

  /** Everything expiring (or already expired) within `days`, plus agents missing their adendum. */
  async alerts(days: number) {
    const now = today();
    const horizon = new Date(now.getTime() + days * 86_400_000);
    const out: Array<{ type: string; severity: 'EXPIRED' | 'EXPIRING' | 'MISSING' | 'INFO'; subject: string; subjectId: string; dueDate: string | null; daysLeft: number | null }> = [];
    const push = (type: string, subject: string, subjectId: string, due: Date | null | undefined) => {
      if (!due) return out.push({ type, severity: 'MISSING', subject, subjectId, dueDate: null, daysLeft: null });
      if (due > horizon) return;
      const left = Math.round((due.getTime() - now.getTime()) / 86_400_000);
      out.push({ type, severity: due < now ? 'EXPIRED' : 'EXPIRING', subject, subjectId, dueDate: day(due), daysLeft: left });
    };

    const [partners, vehicles, drivers, agents, lowFloat] = await Promise.all([
      this.prisma.fleetPartner.findMany({ where: { deletedAt: null, status: { in: ['ACTIVE', 'PENDING'] } }, select: { id: true, companyName: true, mouValidUntil: true } }),
      this.prisma.vehicle.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, plateNumber: true, dnttPermitExpiry: true, kirExpiry: true } }),
      this.prisma.driver.findMany({ where: { deletedAt: null, isActive: true }, select: { id: true, licenseExpiry: true, user: { select: { fullName: true } } } }),
      this.prisma.agent.findMany({ where: { deletedAt: null, status: 'ACTIVE' }, select: { id: true, kioskName: true, adendumSignedAt: true } }),
      this.prisma.wallet.findMany({ where: { ownerType: 'AGENT', walletType: 'DEPOSIT', balance: { lt: 10 } }, select: { ownerId: true, balance: true } }),
    ]);
    for (const p of partners) push('MOU', p.companyName, p.id, p.mouValidUntil);
    for (const v of vehicles) {
      push('DNTT_PERMIT', v.plateNumber, v.id, v.dnttPermitExpiry);
      push('KIR_INSPECTION', v.plateNumber, v.id, v.kirExpiry);
    }
    for (const d of drivers) push('DRIVER_LICENSE', d.user.fullName, d.id, d.licenseExpiry);
    for (const a of agents) if (!a.adendumSignedAt) out.push({ type: 'ADENDUM', severity: 'MISSING', subject: a.kioskName, subjectId: a.id, dueDate: null, daysLeft: null });
    const names = new Map((await this.prisma.agent.findMany({ where: { id: { in: lowFloat.map((w) => w.ownerId) } }, select: { id: true, kioskName: true } })).map((a) => [a.id, a.kioskName]));
    for (const w of lowFloat) out.push({ type: 'LOW_DEPOSIT', severity: 'INFO', subject: `${names.get(w.ownerId) ?? w.ownerId} ($${w.balance.toFixed(2)})`, subjectId: w.ownerId, dueDate: null, daysLeft: null });

    const rank = { EXPIRED: 0, MISSING: 1, EXPIRING: 2, INFO: 3 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.daysLeft ?? 0) - (b.daysLeft ?? 0));
  }
}

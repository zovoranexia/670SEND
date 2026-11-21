import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import { LOCALES, NOTIFICATION_EVENT_CODES } from '@670send/types';
import { pinSchema, tlPhoneSchema, tlWhatsAppPhoneSchema } from '@670send/validation';
import { Authenticated, CurrentActor, RequireAnyPermission, RequirePermissions } from '../common/decorators';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { moneyInput, uuid } from '../logistics/dto';
import type { Actor } from '../rbac/actor';
import { AccessService } from './access.service';
import { ContentService } from './content.service';
import { DirectoryService } from './directory.service';

const limit = (max = 100, def = 30) => z.coerce.number().int().min(1).max(max).default(def);
const isoDate = z.string().datetime();
const code3 = z.string().trim().length(3).transform((v) => v.toUpperCase());
const passwordSchema = z
  .string()
  .min(12, { message: 'errors.validation.password' })
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), { message: 'errors.validation.password' });
const lang = z.enum(LOCALES).default('tet');
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => new Date(`${d}T00:00:00Z`));
const statusSchema = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']), reason: z.string().trim().min(3).max(300).optional() });

/* ===================================================== RBAC, users, audit ===================================================== */

const roleCreate = z.object({
  key: z.string().regex(/^[A-Z][A-Z0-9_]{2,40}$/, { message: 'errors.validation_failed' }),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).optional(),
  permissions: z.array(z.string().min(3).max(80)).max(200).default([]),
});
const roleMeta = z.object({ name: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(300).optional() });
const rolePerms = z.object({ permissions: z.array(z.string().min(3).max(80)).max(200) });
const staffCreate = z.object({ fullName: z.string().trim().min(3).max(120), phone: tlPhoneSchema, email: z.string().trim().email().max(254), preferredLang: lang, roles: z.array(z.string()).min(1).max(5), password: passwordSchema });
const userUpdate = z.object({ fullName: z.string().trim().min(3).max(120).optional(), preferredLang: z.enum(LOCALES).optional() });
const userRoles = z.object({ roles: z.array(z.string()).min(1).max(5) });
const activeBody = z.object({ reason: z.string().trim().max(300).optional() });
const resetBody = z.object({ password: passwordSchema.optional(), pin: pinSchema.optional() }).refine((v) => v.password || v.pin, { message: 'errors.validation_failed' });
const userList = z.object({ q: z.string().trim().max(60).optional(), role: z.string().optional(), active: z.enum(['true', 'false']).transform((v) => v === 'true').optional(), limit: limit(), before: isoDate.optional() });
const auditList = z.object({ entityType: z.string().max(60).optional(), entityId: z.string().max(80).optional(), actorId: uuid.optional(), action: z.string().max(80).optional(), from: isoDate.optional(), to: isoDate.optional(), limit: limit(200, 50), before: isoDate.optional() });

@Controller('admin')
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @RequirePermissions('rbac:manage')
  @Get('roles')
  roles() {
    return this.access.listRoles();
  }

  @RequirePermissions('rbac:manage')
  @Get('permissions')
  permissions() {
    return this.access.listPermissions();
  }

  @RequirePermissions('rbac:manage')
  @Post('roles')
  createRole(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(roleCreate)) b: z.infer<typeof roleCreate>) {
    return this.access.createRole(actor, b);
  }

  @RequirePermissions('rbac:manage')
  @Patch('roles/:id')
  updateRole(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(roleMeta)) b: z.infer<typeof roleMeta>) {
    return this.access.updateRoleMeta(actor, id, b);
  }

  @RequirePermissions('rbac:manage')
  @Put('roles/:id/permissions')
  setPermissions(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(rolePerms)) b: z.infer<typeof rolePerms>) {
    return this.access.setRolePermissions(actor, id, b.permissions);
  }

  @RequirePermissions('rbac:manage')
  @Delete('roles/:id')
  @HttpCode(204)
  async deleteRole(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.access.deleteRole(actor, id);
  }

  @RequirePermissions('users:manage')
  @Get('users')
  users(@Query(new ZodValidationPipe(userList)) q: z.infer<typeof userList>) {
    return this.access.listUsers(q);
  }

  @RequirePermissions('users:manage')
  @Get('users/:id')
  user(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.access.getUser(id);
  }

  @RequirePermissions('users:manage')
  @Post('users')
  createUser(@CurrentActor() actor: Actor, @Body(new ZodValidationPipe(staffCreate)) b: z.infer<typeof staffCreate>) {
    return this.access.createStaff(actor, b);
  }

  @RequirePermissions('users:manage')
  @Patch('users/:id')
  updateUser(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(userUpdate)) b: z.infer<typeof userUpdate>) {
    return this.access.updateUser(actor, id, b);
  }

  @RequirePermissions('users:manage')
  @Put('users/:id/roles')
  setRoles(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(userRoles)) b: z.infer<typeof userRoles>) {
    return this.access.setUserRoles(actor, id, b.roles);
  }

  @RequirePermissions('users:manage')
  @Post('users/:id/deactivate')
  @HttpCode(200)
  deactivate(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(activeBody)) b: z.infer<typeof activeBody>) {
    return this.access.setActive(actor, id, false, b.reason);
  }

  @RequirePermissions('users:manage')
  @Post('users/:id/activate')
  @HttpCode(200)
  activate(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.access.setActive(actor, id, true);
  }

  @RequirePermissions('users:manage')
  @Post('users/:id/reset-credentials')
  @HttpCode(200)
  reset(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(resetBody)) b: z.infer<typeof resetBody>) {
    return this.access.resetCredentials(actor, id, b);
  }

  @RequirePermissions('users:manage')
  @Post('users/:id/unlock')
  @HttpCode(200)
  unlock(@CurrentActor() actor: Actor, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.access.unlock(actor, id);
  }

  @RequirePermissions('audit:read')
  @Get('audit-logs')
  audit(@Query(new ZodValidationPipe(auditList)) q: z.infer<typeof auditList>) {
    return this.access.auditLogs(q);
  }
}

/* ============================================== templates, tariffs, settings ============================================== */

const eventParam = z.enum(NOTIFICATION_EVENT_CODES as unknown as [string, ...string[]]);
const templateBody = z.object({ bodyTemplate: z.string().min(5).max(1000).optional(), isActive: z.boolean().optional() }).refine((v) => v.bodyTemplate !== undefined || v.isActive !== undefined, { message: 'errors.validation_failed' });
const previewBody = z.object({ bodyTemplate: z.string().min(5).max(1000) });
const logQuery = z.object({ shipmentId: uuid.optional(), phone: z.string().max(30).optional(), status: z.enum(['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED']).optional(), eventCode: z.string().optional(), limit: limit(200, 50), before: isoDate.optional() });
const zoneBody = z.object({
  docRate: moneyInput.optional(),
  smallBase2kg: moneyInput.optional(),
  extraPerKg: moneyInput.optional(),
  cargoBase10kg: moneyInput.optional(),
  cargoExtraPerKg: moneyInput.optional(),
  names: z.object({ tet: z.string().min(2).max(60), pt: z.string().min(2).max(60), en: z.string().min(2).max(60), id: z.string().min(2).max(60) }).partial().optional(),
  eta: z.object({ tet: z.string().min(2).max(60), pt: z.string().min(2).max(60), en: z.string().min(2).max(60), id: z.string().min(2).max(60) }).partial().optional(),
});
const addonBody = z.object({ fee: moneyInput.optional(), courierSplitPct: z.union([z.string(), z.number()]).transform(String).refine((v) => /^\d{1,3}(\.\d{1,2})?$/.test(v)).optional(), wholesaleMinParcels: z.number().int().min(2).max(100).optional(), wholesaleFreePickup: z.boolean().optional(), isActive: z.boolean().optional() });
const surchargeBody = z.object({ surcharge: moneyInput });

@Controller('admin')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @RequirePermissions('templates:manage')
  @Get('templates')
  templates() {
    return this.content.listTemplates();
  }

  @RequirePermissions('templates:manage')
  @Put('templates/:event/:lang')
  updateTemplate(@CurrentActor() actor: Actor, @Param('event', new ZodValidationPipe(eventParam)) event: string, @Param('lang', new ZodValidationPipe(z.enum(LOCALES))) l: (typeof LOCALES)[number], @Body(new ZodValidationPipe(templateBody)) b: z.infer<typeof templateBody>) {
    return this.content.updateTemplate(actor, event as never, l, b);
  }

  @RequirePermissions('templates:manage')
  @Post('templates/:event/:lang/preview')
  @HttpCode(200)
  preview(@Param('event', new ZodValidationPipe(eventParam)) event: string, @Body(new ZodValidationPipe(previewBody)) b: z.infer<typeof previewBody>) {
    return this.content.previewTemplate(event as never, b.bodyTemplate);
  }

  @RequirePermissions('templates:manage')
  @Post('templates/:event/:lang/reset')
  @HttpCode(200)
  reset(@CurrentActor() actor: Actor, @Param('event', new ZodValidationPipe(eventParam)) event: string, @Param('lang', new ZodValidationPipe(z.enum(LOCALES))) l: (typeof LOCALES)[number]) {
    return this.content.resetTemplate(actor, event as never, l);
  }

  @RequirePermissions('notification_logs:read')
  @Get('notification-logs')
  logs(@Query(new ZodValidationPipe(logQuery)) q: z.infer<typeof logQuery>) {
    return this.content.notificationLogs(q);
  }

  /** Agents and couriers read the tariff table too (quotes at the kiosk). */
  @RequirePermissions('tariffs:read')
  @Get('tariffs')
  tariffs() {
    return this.content.getTariffs();
  }

  @RequirePermissions('tariffs:manage')
  @Put('tariffs/zones/:code')
  zone(@CurrentActor() actor: Actor, @Param('code') code: string, @Body(new ZodValidationPipe(zoneBody)) b: z.infer<typeof zoneBody>) {
    return this.content.updateZone(actor, code.toUpperCase(), b);
  }

  @RequirePermissions('tariffs:manage')
  @Put('tariffs/addons/:service')
  addon(@CurrentActor() actor: Actor, @Param('service', new ZodValidationPipe(z.enum(['MOTOR_PICKUP', 'MOTOR_DELIVERY', 'CARGO_PICKUP', 'CARGO_DELIVERY']))) service: string, @Body(new ZodValidationPipe(addonBody)) b: z.infer<typeof addonBody>) {
    return this.content.updateAddon(actor, service as never, b);
  }

  @RequirePermissions('tariffs:manage')
  @Put('tariffs/municipalities/:code/surcharge')
  surcharge(@CurrentActor() actor: Actor, @Param('code', new ZodValidationPipe(code3)) code: string, @Body(new ZodValidationPipe(surchargeBody)) b: z.infer<typeof surchargeBody>) {
    return this.content.updateSurcharge(actor, code, b.surcharge);
  }

  @RequirePermissions('settings:manage')
  @Get('settings')
  settings() {
    return this.content.listSettings();
  }

  @RequirePermissions('settings:manage')
  @Put('settings/:key')
  setting(@CurrentActor() actor: Actor, @Param('key') key: string, @Body() body: { value?: unknown }) {
    return this.content.updateSetting(actor, key, body?.value);
  }
}

/* ===================================================== partner directory ===================================================== */

const fieldUser = {
  fullName: z.string().trim().min(3, { message: 'errors.validation.name' }).max(120),
  phone: tlWhatsAppPhoneSchema,
  email: z.string().trim().email().max(254).optional(),
  pin: pinSchema,
  preferredLang: lang,
};
const agentCreate = z.object({
  ...fieldUser,
  municipalityCode: code3,
  kioskName: z.string().trim().min(3).max(120),
  address: z.string().trim().min(3).max(300),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  openingHours: z.string().trim().max(120).optional(),
  hasDigitalScale: z.boolean().default(false),
  hasSecureStorage: z.boolean().default(false),
  external670LinkAgentId: z.string().trim().max(80).optional(),
});
// NOT derived with .partial() from agentCreate: its `.default(false)` flags would be re-applied and silently
// reset whatever the PATCH did not mention.
const agentUpdate = agentCreate
  .pick({ kioskName: true, address: true, lat: true, lng: true, openingHours: true, external670LinkAgentId: true })
  .partial()
  .extend({ hasDigitalScale: z.boolean().optional(), hasSecureStorage: z.boolean().optional() });
const agentList = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']).optional(), municipalityCode: code3.optional(), limit: limit(200, 100) });
const courierCreate = z.object({ ...fieldUser, municipalityCode: code3, hubCode: z.string().max(40).optional(), vehicleType: z.enum(['MOTORBIKE', 'PICKUP']), plateNumber: z.string().trim().max(20).optional() });
const courierUpdate = z.object({ hubCode: z.string().max(40).optional(), vehicleType: z.enum(['MOTORBIKE', 'PICKUP']).optional(), plateNumber: z.string().trim().max(20).optional(), isAvailable: z.boolean().optional(), status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']).optional() });
const bank = z.object({ bank: z.string().trim().min(2).max(40), accountName: z.string().trim().min(2).max(120), accountNo: z.string().trim().min(4).max(40) });
const partnerCreate = z.object({
  ...fieldUser,
  password: passwordSchema.optional(),
  companyName: z.string().trim().min(3).max(160),
  serveRegNo: z.string().trim().max(60).optional(),
  mouNumber: z.string().trim().max(60).optional(),
  mouSignedAt: dateOnly.optional(),
  mouValidUntil: dateOnly.optional(),
  payoutCycle: z.enum(['DAILY', 'WEEKLY']).default('WEEKLY'),
  payoutChannel: z.enum(['BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY']),
  bank: bank.optional(),
});
const partnerUpdate = z.object({ companyName: z.string().trim().min(3).max(160).optional(), serveRegNo: z.string().trim().max(60).optional(), payoutCycle: z.enum(['DAILY', 'WEEKLY']).optional(), payoutChannel: z.enum(['BNCTL', 'BNU', 'MANDIRI', 'BRI', 'MOSAN', 'TPAY']).optional(), mouAutoRenew: z.boolean().optional() });
const mouBody = z.object({ mouNumber: z.string().trim().max(60).optional(), mouSignedAt: dateOnly.optional(), mouValidUntil: dateOnly, mouDocumentUrl: z.string().url().max(500).optional() });
const vehicleCreate = z.object({ fleetPartnerId: uuid, plateNumber: z.string().trim().min(4).max(20), vehicleType: z.enum(['BUS_PASSENGER', 'PICKUP_CARGO', 'TRUCK_CARGO', 'SEA_FERRY']), routeCorridor: z.enum(['LOCAL', 'EAST', 'SOUTH', 'WEST', 'SEA']), maxParcelSlots: z.number().int().min(1).max(100).optional(), dnttPermitNo: z.string().trim().max(60).optional(), dnttPermitExpiry: dateOnly.optional(), kirExpiry: dateOnly.optional() });
const vehiclePermits = z.object({ dnttPermitNo: z.string().trim().max(60).optional(), dnttPermitExpiry: dateOnly.optional(), kirExpiry: dateOnly.optional(), maxParcelSlots: z.number().int().min(1).max(100).optional() });
const driverCreate = z.object({ ...fieldUser, fleetPartnerId: uuid, licenseNumber: z.string().trim().min(3).max(40), licenseExpiry: dateOnly.optional() });
const driverLicense = z.object({ licenseNumber: z.string().trim().min(3).max(40).optional(), licenseExpiry: dateOnly.optional() });
const fleetScope = z.object({ fleetPartnerId: uuid.optional() });
const alertsQuery = z.object({ days: z.coerce.number().int().min(1).max(365).default(30) });
const availability = z.object({ available: z.boolean() });

@Controller()
export class DirectoryController {
  constructor(private readonly dir: DirectoryService) {}

  /* ---- field apps (agent / courier / driver PWA) ---- */
  /** Who am I in the field: kiosk + municipality, courier + municipality + hub, driver + fleet company. */
  @Authenticated() @Get('field/profile') fieldProfile(@CurrentActor() a: Actor) { return this.dir.fieldProfile(a); }
  /** Active kiosks of a municipality, so the drop-off wizard can pick the destination kiosk (no phone numbers). */
  @RequirePermissions('shipments:create') @Get('kiosks') kiosks(@Query(new ZodValidationPipe(z.object({ municipalityCode: code3 }))) q: { municipalityCode: string }) { return this.dir.listKiosks(q.municipalityCode); }

  /* ---- agents ---- */
  @RequirePermissions('agents:manage') @Post('admin/agents') createAgent(@CurrentActor() a: Actor, @Body(new ZodValidationPipe(agentCreate)) b: z.infer<typeof agentCreate>) { return this.dir.createAgent(a, b); }
  @RequirePermissions('agents:read') @Get('admin/agents') agents(@Query(new ZodValidationPipe(agentList)) q: z.infer<typeof agentList>) { return this.dir.listAgents(q); }
  @RequirePermissions('agents:read') @Get('admin/agents/:id') agent(@Param('id', new ParseUUIDPipe()) id: string) { return this.dir.agentDto(id); }
  @RequirePermissions('agents:manage') @Patch('admin/agents/:id') updateAgent(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(agentUpdate)) b: z.infer<typeof agentUpdate>) { return this.dir.updateAgent(a, id, b); }
  @RequirePermissions('agents:manage') @Post('admin/agents/:id/adendum') @HttpCode(200) adendum(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string) { return this.dir.signAdendum(a, id); }
  @RequirePermissions('agents:manage') @Post('admin/agents/:id/status') @HttpCode(200) agentStatus(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(statusSchema)) b: z.infer<typeof statusSchema>) { return this.dir.setAgentStatus(a, id, b); }

  /* ---- couriers ---- */
  @RequirePermissions('couriers:manage') @Post('admin/couriers') createCourier(@CurrentActor() a: Actor, @Body(new ZodValidationPipe(courierCreate)) b: z.infer<typeof courierCreate>) { return this.dir.createCourier(a, b); }
  @RequirePermissions('couriers:read') @Get('admin/couriers') couriers(@Query(new ZodValidationPipe(z.object({ municipalityCode: code3.optional(), limit: limit(200, 100) }))) q: { municipalityCode?: string; limit: number }) { return this.dir.listCouriers(q); }
  @RequirePermissions('couriers:manage') @Patch('admin/couriers/:id') updateCourier(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(courierUpdate)) b: z.infer<typeof courierUpdate>) { return this.dir.updateCourier(a, id, b); }
  @RequirePermissions('courier_jobs:read_own') @Patch('courier/me/availability') availability(@CurrentActor() a: Actor, @Body(new ZodValidationPipe(availability)) b: z.infer<typeof availability>) { return this.dir.setOwnAvailability(a, b.available); }

  /* ---- fleet partners ---- */
  @RequirePermissions('fleet_partners:manage') @Post('admin/fleet-partners') createPartner(@CurrentActor() a: Actor, @Body(new ZodValidationPipe(partnerCreate)) b: z.infer<typeof partnerCreate>) { return this.dir.createFleetPartner(a, b); }
  @RequirePermissions('fleet_partners:read') @Get('admin/fleet-partners') partners(@Query(new ZodValidationPipe(z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED']).optional(), limit: limit(200, 100) }))) q: { status?: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'TERMINATED'; limit: number }) { return this.dir.listFleetPartners(q); }
  @RequirePermissions('fleet_partners:read') @Get('admin/fleet-partners/:id') partner(@Param('id', new ParseUUIDPipe()) id: string) { return this.dir.partnerDto(id); }
  @RequirePermissions('fleet_partners:manage') @Patch('admin/fleet-partners/:id') updatePartner(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(partnerUpdate)) b: z.infer<typeof partnerUpdate>) { return this.dir.updateFleetPartner(a, id, b); }
  @RequirePermissions('fleet_partners:manage') @Post('admin/fleet-partners/:id/mou') @HttpCode(200) mou(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(mouBody)) b: z.infer<typeof mouBody>) { return this.dir.renewMou(a, id, b); }
  @RequirePermissions('fleet_partners:manage') @Put('admin/fleet-partners/:id/bank') setBank(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(bank)) b: z.infer<typeof bank>) { return this.dir.setBankDetails(a, id, b); }
  @RequirePermissions('fleet_partners:manage') @Post('admin/fleet-partners/:id/status') @HttpCode(200) partnerStatus(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(statusSchema)) b: z.infer<typeof statusSchema>) { return this.dir.setFleetStatus(a, id, b); }

  /* ---- vehicles & drivers: Ops verify; the fleet owner manages their own (and sends them to verification) ---- */
  @RequireAnyPermission('vehicles:manage', 'vehicles:manage_own') @Post('fleet/vehicles') createVehicle(@CurrentActor() a: Actor, @Body(new ZodValidationPipe(vehicleCreate)) b: z.infer<typeof vehicleCreate>) { return this.dir.createVehicle(a, b); }
  @RequireAnyPermission('vehicles:read', 'vehicles:manage_own') @Get('fleet/vehicles') vehicles(@CurrentActor() a: Actor, @Query(new ZodValidationPipe(fleetScope)) q: z.infer<typeof fleetScope>) { return this.dir.listVehicles(a, q); }
  @RequireAnyPermission('vehicles:manage', 'vehicles:manage_own') @Patch('fleet/vehicles/:id/permits') permits(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(vehiclePermits)) b: z.infer<typeof vehiclePermits>) { return this.dir.updateVehiclePermits(a, id, b); }
  @RequirePermissions('vehicles:manage') @Post('admin/vehicles/:id/verify') @HttpCode(200) verifyVehicle(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string) { return this.dir.setVehicleActive(a, id, true); }
  @RequirePermissions('vehicles:manage') @Post('admin/vehicles/:id/deactivate') @HttpCode(200) deactivateVehicle(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string) { return this.dir.setVehicleActive(a, id, false); }

  @RequireAnyPermission('drivers:manage', 'drivers:manage_own') @Post('fleet/drivers') createDriver(@CurrentActor() a: Actor, @Body(new ZodValidationPipe(driverCreate)) b: z.infer<typeof driverCreate>) { return this.dir.createDriver(a, b); }
  @RequireAnyPermission('drivers:read', 'drivers:manage_own') @Get('fleet/drivers') drivers(@CurrentActor() a: Actor, @Query(new ZodValidationPipe(fleetScope)) q: z.infer<typeof fleetScope>) { return this.dir.listDrivers(a, q); }
  @RequireAnyPermission('drivers:manage', 'drivers:manage_own') @Patch('fleet/drivers/:id/license') license(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string, @Body(new ZodValidationPipe(driverLicense)) b: z.infer<typeof driverLicense>) { return this.dir.updateDriverLicense(a, id, b); }
  @RequirePermissions('drivers:manage') @Post('admin/drivers/:id/verify') @HttpCode(200) verifyDriver(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string) { return this.dir.setDriverActive(a, id, true); }
  @RequirePermissions('drivers:manage') @Post('admin/drivers/:id/deactivate') @HttpCode(200) deactivateDriver(@CurrentActor() a: Actor, @Param('id', new ParseUUIDPipe()) id: string) { return this.dir.setDriverActive(a, id, false); }

  /* ---- compliance ---- */
  @RequireAnyPermission('fleet_partners:read', 'agents:read') @Get('admin/compliance/alerts') alerts(@Query(new ZodValidationPipe(alertsQuery)) q: z.infer<typeof alertsQuery>) { return this.dir.alerts(q.days); }
}

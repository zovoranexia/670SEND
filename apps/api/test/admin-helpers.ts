import { bearer, createUser, type CreatedUser, type TestCtx } from './helpers';
import { createStaff, inboundScan, otpSentTo, shipInTransit, stagePhoto, type IntakeOpts, type Network } from './scenario';

/** Parcels that have travelled the whole chain and wait at the Baucau kiosk (ARRIVED_AT_DEST_AGENT). */
export async function arrivedParcels(ctx: TestCtx, net: Network, count = 1, opts: Partial<IntakeOpts> = {}) {
  const shipped = await shipInTransit(ctx, net, count, opts);
  const scan = await inboundScan(ctx, net.bcu.token, { code: shipped.bagCode, condition: 'INTACT' });
  if (scan.status !== 200) throw new Error(`inbound failed ${scan.status} ${JSON.stringify(scan.body)}`);
  return shipped;
}

/** Hand a waiting parcel to its recipient at the kiosk (OTP read from the WhatsApp the recipient got). */
export async function deliverAtKiosk(ctx: TestCtx, net: Network, parcel: { waybill: string; recipientPhone: string }, extra: object = {}) {
  return ctx.http.post('/v1/pod/verify').set(bearer(net.bcu.token)).send({
    waybill: parcel.waybill,
    otp: otpSentTo(ctx, parcel.recipientPhone),
    collector: { name: 'José Guterres', idType: 'BI', idNumber: 'BI998877', isRepresentative: false },
    photoUploadId: await stagePhoto(ctx, net.bcu.token, 'PROOF_OF_DELIVERY'),
    ...extra,
  });
}

export const finance = (ctx: TestCtx) => createStaff(ctx, 'FINANCE_ADMIN');
export const cs = (ctx: TestCtx) => createStaff(ctx, 'CS_CLAIMS_ADMIN');
export const ops = (ctx: TestCtx) => createStaff(ctx, 'OPS_HUB_ADMIN');
export const superAdmin = (ctx: TestCtx) => createStaff(ctx, 'SUPER_ADMIN');

/** A user holding several roles at once (used to prove maker-checker rules apply to PEOPLE, not roles). */
export async function multiRole(ctx: TestCtx, roles: string[]): Promise<{ user: CreatedUser; token: string }> {
  const user = await createUser(ctx, roles);
  const res = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: user.password });
  return { user, token: res.body.accessToken as string };
}

export const auth = (t: string) => bearer(t);
export const num = (v: string | number) => Number(v);

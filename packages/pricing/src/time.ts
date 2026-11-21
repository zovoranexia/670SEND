import { STORAGE_POLICY, parseMoney, type MoneyUnits } from './core';

/** Timor-Leste is UTC+9 with no daylight saving. All business dates are computed in this zone. */
export const DILI_TZ = 'Asia/Dili';

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: DILI_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function diliParts(d: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const get = (type: string) => Number(fmt.formatToParts(d).find((p) => p.type === type)!.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute') };
}

/** `261121` for 21 Nov 2026 (Dili date). Used in waybill numbers. */
export function yymmddDili(d: Date): string {
  const p = diliParts(d);
  return `${String(p.year % 100).padStart(2, '0')}${String(p.month).padStart(2, '0')}${String(p.day).padStart(2, '0')}`;
}

/** `HH:mm` in Dili time. */
export function formatDiliTime(d: Date): string {
  const p = diliParts(d);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/** `DD/MM/YYYY HH:mm` in Dili time (receipts). */
export function formatDiliDateTime(d: Date): string {
  const p = diliParts(d);
  const z = (n: number) => String(n).padStart(2, '0');
  return `${z(p.day)}/${z(p.month)}/${p.year} ${z(p.hour)}:${z(p.minute)}`;
}

const dayNumber = (d: Date) => {
  const p = diliParts(d);
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
};

/**
 * Storage day counting in calendar days of Dili time: the arrival day is Day 1.
 *   Days 1–5   free storage            Day 3 & 5   WhatsApp reminders
 *   Days 6–14  USD 0.50 per day        Day 15      → return to sender
 */
export function storageDay(arrivedAt: Date, now: Date): number {
  return Math.max(1, dayNumber(now) - dayNumber(arrivedAt) + 1);
}

/** Accrued storage penalty on a given storage day: 0.50 × (min(day, 14) − 5), none before Day 6. */
export function storagePenaltyForDay(day: number): MoneyUnits {
  if (day < STORAGE_POLICY.penaltyFromDay) return 0n;
  const billable = Math.min(day, STORAGE_POLICY.rtsAfterDays) - (STORAGE_POLICY.freeDays);
  return parseMoney(STORAGE_POLICY.penaltyPerDayUsd) * BigInt(billable);
}

export const hoursBetween = (from: Date, to: Date): number => (to.getTime() - from.getTime()) / 3_600_000;

const DILI_OFFSET_MS = 9 * 3_600_000;
const DAY_MS = 86_400_000;

/** 00:00 Dili time of the Dili calendar day containing `d`, as a UTC instant. */
export function diliStartOfDayUtc(d: Date): Date {
  const p = diliParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - DILI_OFFSET_MS);
}

/** 00:00 Dili time on the 1st of the month containing `d`, as a UTC instant. */
export function diliStartOfMonthUtc(d: Date): Date {
  const p = diliParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, 1) - DILI_OFFSET_MS);
}

/** ISO weekday in Dili: 1 = Monday … 7 = Sunday. */
export function diliWeekday(d: Date): number {
  const p = diliParts(d);
  const w = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay(); // 0 = Sunday
  return w === 0 ? 7 : w;
}

/**
 * Fleet payout period (half-open [start, end), Dili midnight to midnight):
 *   DAILY   the previous Dili day
 *   WEEKLY  the previous full Monday–Sunday week
 */
export function defaultPayoutPeriod(cycle: 'DAILY' | 'WEEKLY', now: Date): { start: Date; end: Date } {
  const todayStart = diliStartOfDayUtc(now);
  if (cycle === 'DAILY') return { start: new Date(todayStart.getTime() - DAY_MS), end: todayStart };
  const thisMonday = new Date(todayStart.getTime() - (diliWeekday(now) - 1) * DAY_MS);
  return { start: new Date(thisMonday.getTime() - 7 * DAY_MS), end: thisMonday };
}

import { describe, expect, it } from 'vitest';
import {
  WAYBILL_REGEX,
  normalizeTlPhone,
  otpSchema,
  pinSchema,
  senderKycSchema,
  tlWhatsAppPhoneSchema,
  waybillSchema,
} from '../index';

describe('phone', () => {
  it('normalises common spellings', () => {
    for (const v of ['77123456', '+670 7712 3456', '0067077123456', '670-7712-3456']) {
      expect(normalizeTlPhone(v)).toBe('+67077123456');
    }
  });
  it('accepts mobile WhatsApp numbers only', () => {
    expect(tlWhatsAppPhoneSchema.safeParse('77123456').success).toBe(true);
    expect(tlWhatsAppPhoneSchema.safeParse('3312345').success).toBe(false);
    expect(tlWhatsAppPhoneSchema.safeParse('+6281234567890').success).toBe(false);
  });
});

describe('waybill / otp / pin', () => {
  it('matches the spec example', () => {
    expect(WAYBILL_REGEX.test('670S-DIL-BCU-261121-0042')).toBe(true);
    expect(waybillSchema.safeParse('670s-dil-bcu-261121-0042').success).toBe(true);
    expect(waybillSchema.safeParse('670S-DIL-BCU-261121-42').success).toBe(false);
  });
  it('otp is exactly 6 digits', () => {
    expect(otpSchema.safeParse('123456').success).toBe(true);
    expect(otpSchema.safeParse('12345').success).toBe(false);
    expect(otpSchema.safeParse('12345a').success).toBe(false);
  });
  it('rejects weak PINs', () => {
    expect(pinSchema.safeParse('123456').success).toBe(false);
    expect(pinSchema.safeParse('000000').success).toBe(false);
    expect(pinSchema.safeParse('482913').success).toBe(true);
  });
});

describe('KYC', () => {
  it('rejects anonymous senders', () => {
    expect(
      senderKycSchema.safeParse({
        senderName: '',
        senderIdType: 'BI',
        senderIdNumber: '',
        senderPhone: '77123456',
      }).success,
    ).toBe(false);
  });
  it('defaults language to Tetun', () => {
    const r = senderKycSchema.parse({
      senderName: 'Maria da Silva',
      senderIdType: 'BI',
      senderIdNumber: 'BI123456',
      senderPhone: '77123456',
    });
    expect(r.senderLang).toBe('tet');
  });
});

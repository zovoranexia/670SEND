import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { fromPrismaLanguage, type Locale } from '@670send/types';
import { t } from '@670send/i18n';
import { formatDiliDateTime, formatMoneyDisplay, parseMoney } from '@670send/pricing';
import { maskPhone } from './dto';
import { EscPosBuilder } from './escpos';

export type PrintableShipment = Prisma.ShipmentGetPayload<{
  include: {
    originMunicipality: { select: { name: true } };
    destMunicipality: { select: { name: true } };
    destAgent: { select: { kioskName: true } };
  };
}>;

export interface PrintJob {
  lang: Locale;
  widthChars: 32;
  kind: 'receipt' | 'label';
  /** Plain text for WhatsApp / on-screen preview. */
  text: string;
  /** Raw ESC/POS bytes (base64) for Web Bluetooth or the RawBT app. */
  escposBase64: string;
}

const usd = (d: Prisma.Decimal) => formatMoneyDisplay(parseMoney(d.toFixed(4)));

/**
 * 58 mm ESC/POS documents, localized (Tetun default; switchable to pt / en / id before printing):
 *  • receipt — header, parties, fee lines, the sender's declaration, the liability limit and the claim rule;
 *  • label   — large destination + waybill + QR for the parcel.
 */
@Injectable()
export class ReceiptsService {
  receipt(s: PrintableShipment, lang: Locale): PrintJob {
    const r = (k: string) => t(lang, `receipt.${k}`);
    const b = new EscPosBuilder().init();

    b.align('center').bold(true).size(2, 2).line('670SEND').size(1, 1).line(r('title')).bold(false).rule();
    b.align('left');
    // Paragraph wrapping: a label + 24-char waybill is 33 columns in English — it must never overflow the paper.
    b.paragraph(`${r('waybill')}: ${s.waybillNumber}`);
    b.paragraph(`${r('date')}: ${formatDiliDateTime(s.createdAt)}`);
    b.paragraph(`${r('origin')}: ${s.originMunicipality.name}`);
    b.paragraph(`${r('destination')}: ${s.destMunicipality.name}${s.destAgent ? ` (${s.destAgent.kioskName})` : ''}`);
    b.rule();
    b.paragraph(`${r('sender')}: ${s.senderName}`).paragraph(maskPhone(s.senderPhone));
    b.paragraph(`${r('recipient')}: ${s.recipientName}`).paragraph(maskPhone(s.recipientPhone));
    b.rule();
    b.columns(r('weight'), `${Number(s.actualWeightKg)} kg`);
    b.columns(r('chargeable'), `${s.chargeableWeightKg} kg`);
    b.paragraph(`${r('canal')}: ${t(lang, `web.calculator.canal.${s.transportCanal}`)}`);
    b.paragraph(`${r('scheme')}: ${t(lang, `web.schemes.${s.serviceScheme}`)}`);
    b.rule();
    b.columns(r('baseFee'), usd(s.baseShippingFeeUsd));
    if (s.pickupAddonFeeUsd.greaterThan(0)) b.columns(r('pickupFee'), usd(s.pickupAddonFeeUsd));
    if (s.deliveryAddonFeeUsd.greaterThan(0)) b.columns(r('deliveryFee'), usd(s.deliveryAddonFeeUsd));
    if (s.insuranceFeeUsd.greaterThan(0)) b.columns(r('insuranceFee'), usd(s.insuranceFeeUsd));
    b.rule('=');
    b.bold(true).size(1, 2).columns(r('total'), usd(s.totalFeeUsd)).size(1, 1).bold(false);
    b.paragraph(r('paidCash'));
    b.rule();
    b.paragraph(r('declaration')).feed(1);
    b.paragraph(r('liability')).feed(1);
    b.paragraph(r('claimNotice')).feed(1);
    b.align('center').qr(s.waybillNumber, 6).feed(1);
    b.paragraph(r('trackAt')).paragraph(r('thanks')).feed(3).cut();

    return this.job('receipt', lang, b);
  }

  label(s: PrintableShipment, lang: Locale): PrintJob {
    const b = new EscPosBuilder().init();
    b.align('center').bold(true).size(1, 1).line('670SEND').line(t(lang, 'receipt.destination')).size(2, 3).line(s.destMunicipality.name.slice(0, 15)).size(1, 1);
    if (s.destAgent) b.paragraph(s.destAgent.kioskName);
    b.bold(false).rule('=');
    b.qr(s.waybillNumber, 8).feed(1);
    b.bold(true).paragraph(s.waybillNumber).bold(false);
    b.paragraph(`${Number(s.actualWeightKg)} kg  |  ${s.chargeableWeightKg} kg`);
    if (s.sealCode) b.paragraph(`SEAL ${s.sealCode}`);
    if (s.isFragile) b.rule().bold(true).size(2, 2).line('FRAJIL').size(1, 1).line('FRAGILE / MUDAH PECAH').bold(false);
    b.feed(3).cut();
    return this.job('label', lang, b);
  }

  private job(kind: 'receipt' | 'label', lang: Locale, b: EscPosBuilder): PrintJob {
    return { lang, widthChars: 32, kind, text: b.plainText(), escposBase64: b.build().toString('base64') };
  }

  /** Default print language: the parcel's sender language (the customer holding the receipt). */
  defaultLang(s: Pick<PrintableShipment, 'senderLang'>): Locale {
    return fromPrismaLanguage(s.senderLang);
  }
}

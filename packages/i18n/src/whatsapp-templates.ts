import type { Locale, NotificationEventCode } from '@670send/types';

/**
 * Default WhatsApp templates (9 tracking states + Day-3 / Day-5 storage reminders)
 * in all 4 languages. Seeded into `notification_templates`; afterwards editable
 * from the admin Template Editor without a deploy.
 *
 * Placeholders use {{variable}}. Allowed variables per event are declared in
 * NOTIFICATION_VARIABLES (@670send/types). WhatsApp bold = *text*.
 *
 * Tetun strings for the 9 states follow the SOP wording verbatim; the other
 * languages are faithful translations. A native-speaker review of the Tetun
 * and Portuguese copy is recommended before go-live.
 */
export const WHATSAPP_TEMPLATES: Record<NotificationEventCode, Record<Locale, string>> = {
  PICKUP_ASSIGNED: {
    tet: 'Kurir 670Send ({{courierName}}) iha dalan ona atu foti Ita-nia pakote. Kontaktu kurir: {{courierPhone}}.',
    pt: 'O estafeta 670Send ({{courierName}}) já está a caminho para recolher a sua encomenda. Contacto do estafeta: {{courierPhone}}.',
    en: 'The 670Send courier ({{courierName}}) is on the way to collect your parcel. Courier contact: {{courierPhone}}.',
    id: 'Kurir 670Send ({{courierName}}) sedang menuju lokasi Anda untuk menjemput paket. Kontak kurir: {{courierPhone}}.',
  },
  DROPPED_AT_ORIGIN: {
    tet: 'Pakote simu ona! Resi: *{{waybill}}*. Akompaña iha {{trackUrl}}.',
    pt: 'Encomenda recebida! Guia: *{{waybill}}*. Acompanhe em {{trackUrl}}.',
    en: 'Parcel received! Waybill: *{{waybill}}*. Track it at {{trackUrl}}.',
    id: 'Paket diterima! Resi: *{{waybill}}*. Lacak di {{trackUrl}}.',
  },
  CONSOLIDATED_AT_HUB: {
    tet: 'Ita-nia pakote prepara ona iha Hub {{hubName}} hodi tula ba armada.',
    pt: 'A sua encomenda está preparada no Hub {{hubName}} para embarcar na frota.',
    en: 'Your parcel is prepared at the {{hubName}} Hub for loading onto the fleet.',
    id: 'Paket Anda sudah disiapkan di Hub {{hubName}} untuk dimuat ke armada.',
  },
  IN_TRANSIT: {
    tet: 'Pakote sai ona husi {{originName}} ba {{destName}} ho armada ofisiál 670Send.',
    pt: 'A encomenda partiu de {{originName}} para {{destName}} na frota oficial 670Send.',
    en: 'Your parcel has left {{originName}} for {{destName}} on an official 670Send fleet vehicle.',
    id: 'Paket berangkat dari {{originName}} ke {{destName}} dengan armada resmi 670Send.',
  },
  ARRIVED_AT_DEST_AGENT: {
    tet: "Pakote to'o ona iha Ajente {{kioskName}}, {{kioskLocation}}! Lori BI & OTP: *{{otp}}*.",
    pt: 'A encomenda chegou ao Agente {{kioskName}}, {{kioskLocation}}! Leve o BI e o OTP: *{{otp}}*.',
    en: 'Your parcel has arrived at Agent {{kioskName}}, {{kioskLocation}}! Bring your ID and OTP: *{{otp}}*.',
    id: 'Paket tiba di Agen {{kioskName}}, {{kioskLocation}}! Bawa identitas dan OTP: *{{otp}}*.',
  },
  OUT_FOR_DELIVERY: {
    tet: 'Kurir lokál lori hela Ita-nia pakote ba Ita-nia hela-fatin. Prepara OTP.',
    pt: 'O estafeta local está a levar a sua encomenda à sua morada. Prepare o OTP.',
    en: 'A local courier is bringing your parcel to your address. Have your OTP ready.',
    id: 'Kurir lokal sedang mengantar paket Anda ke alamat Anda. Siapkan OTP.',
  },
  DELIVERED: {
    tet: 'Pakote simu ona husi {{collectorName}} iha {{time}}. Obrigadu uza 670Send!',
    pt: 'Encomenda recebida por {{collectorName}} às {{time}}. Obrigado por usar a 670Send!',
    en: 'Parcel received by {{collectorName}} at {{time}}. Thank you for using 670Send!',
    id: 'Paket diterima oleh {{collectorName}} pada {{time}}. Terima kasih telah menggunakan 670Send!',
  },
  ON_HOLD_ISSUE: {
    tet: 'Atensaun: Iha obstákulu iha pakote {{waybill}}. Ekipa CS sei kontaktu Ita.',
    pt: 'Atenção: há uma ocorrência com a encomenda {{waybill}}. A equipa de CS irá contactá-lo.',
    en: 'Attention: there is an issue with parcel {{waybill}}. Our CS team will contact you.',
    id: 'Perhatian: ada kendala pada paket {{waybill}}. Tim CS akan menghubungi Anda.',
  },
  RETURN_TO_SENDER: {
    tet: 'Pakote {{waybill}} la foti durante loron 14 no haruka fila fali ba Hub Dili.',
    pt: 'A encomenda {{waybill}} não foi levantada durante 14 dias e foi devolvida ao Hub de Díli.',
    en: 'Parcel {{waybill}} was not collected within 14 days and is being returned to the Dili Hub.',
    id: 'Paket {{waybill}} tidak diambil selama 14 hari dan dikembalikan ke Hub Dili.',
  },
  STORAGE_REMINDER_DAY3: {
    tet: "Lembransa: Ita-nia pakote {{waybill}} iha Ajente {{kioskName}}, {{kioskLocation}}. Foti iha loron {{daysLeft}} nia laran atu la selu taxa armazenamentu. Lori BI no kódigu OTP.",
    pt: 'Lembrete: a sua encomenda {{waybill}} aguarda no Agente {{kioskName}}, {{kioskLocation}}. Levante-a nos próximos {{daysLeft}} dias para evitar a taxa de armazenamento. Leve o BI e o código OTP.',
    en: 'Reminder: your parcel {{waybill}} is waiting at Agent {{kioskName}}, {{kioskLocation}}. Collect it within the next {{daysLeft}} days to avoid a storage fee. Bring your ID and OTP code.',
    id: 'Pengingat: paket Anda {{waybill}} menunggu di Agen {{kioskName}}, {{kioskLocation}}. Ambil dalam {{daysLeft}} hari ke depan agar tidak dikenai biaya penyimpanan. Bawa identitas dan kode OTP.',
  },
  STORAGE_REMINDER_DAY5: {
    tet: 'Lembransa ikus: ohin loron gratis ikus ba pakote {{waybill}} iha Ajente {{kioskName}}, {{kioskLocation}}. Hahú aban, taxa armazenamentu USD {{dailyFee}} kada loron. Foti lalais!',
    pt: 'Último lembrete: hoje é o último dia gratuito para a encomenda {{waybill}} no Agente {{kioskName}}, {{kioskLocation}}. A partir de amanhã aplica-se uma taxa de armazenamento de USD {{dailyFee}} por dia. Levante-a depressa!',
    en: 'Final reminder: today is the last free day for parcel {{waybill}} at Agent {{kioskName}}, {{kioskLocation}}. From tomorrow a storage fee of USD {{dailyFee}} per day applies. Please collect it soon!',
    id: 'Pengingat terakhir: hari ini hari gratis terakhir untuk paket {{waybill}} di Agen {{kioskName}}, {{kioskLocation}}. Mulai besok dikenakan biaya penyimpanan USD {{dailyFee}} per hari. Segera ambil!',
  },
};

/** Extract {{variables}} used by a template body. */
export function extractTemplateVariables(body: string): string[] {
  const found = new Set<string>();
  for (const m of body.matchAll(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g)) found.add(m[1]!);
  return [...found];
}

/** Render a template; unknown placeholders are left visible so mistakes are noticed. */
export function renderTemplate(body: string, vars: Record<string, string | number | null | undefined>): string {
  return body.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (whole, key: string) => {
    const v = vars[key];
    return v === undefined || v === null ? whole : String(v);
  });
}

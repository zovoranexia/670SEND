import iconv from 'iconv-lite';
import { EscPosBuilder, LINE_WIDTH, sanitizeForPrinter, wrapText } from '../src/logistics/escpos';
import { bearer, createTestApp, type TestCtx } from './helpers';
import { agentIntake, createAgent, createNetwork, type Network } from './scenario';

describe('ESC/POS builder (58 mm, 32 columns, CP858)', () => {
  const bytes = (b: EscPosBuilder) => b.build();
  const hex = (b: Buffer) => b.toString('hex');

  it('initialises the printer and selects code page CP858', () => {
    expect(hex(bytes(new EscPosBuilder().init()))).toBe('1b40' + '1b7413');
  });

  it('encodes Tetun / Portuguese letters as CP858 bytes, not UTF-8', () => {
    const out = bytes(new EscPosBuilder().line('Díli ç ã é ó ú'));
    // í=A1 ç=87 ã=C6 é=82 ó=A2 ú=A3
    expect(hex(out)).toContain('44a16c69'); // "D" í "l" "i"
    expect(out.includes(Buffer.from([0x87]))).toBe(true);
    expect(out.includes(Buffer.from([0xc6]))).toBe(true);
    expect(out.includes(Buffer.from([0xc3, 0xad]))).toBe(false); // no UTF-8 "í"
    expect(iconv.decode(out.subarray(0, out.length - 1), 'cp858')).toBe('Díli ç ã é ó ú');
  });

  it('maps characters the printer cannot print to safe ASCII', () => {
    expect(sanitizeForPrinter('a — b “q” ’s’ ≤10 kg 3×')).toBe('a - b "q" \'s\' <=10 kg 3x');
  });

  it('wraps to the line width without breaking words, and hard-breaks over-long tokens', () => {
    const lines = wrapText('Klaim estragus tenke halo bainhira simu pakote, iha oin Ajente.');
    expect(lines.every((l) => l.length <= LINE_WIDTH)).toBe(true);
    expect(lines.join(' ')).toBe('Klaim estragus tenke halo bainhira simu pakote, iha oin Ajente.');
    const long = wrapText('X'.repeat(70));
    expect(long.map((l) => l.length)).toEqual([32, 32, 6]);
  });

  it('right-aligns amounts in two columns, always exactly 32 characters', () => {
    const b = new EscPosBuilder().columns('Taxa baziku', '$4.00').columns('A very long label that does not fit at all', '$12.50');
    for (const line of b.plainText().split('\n')) expect(line).toHaveLength(LINE_WIDTH);
    expect(b.plainText().split('\n')[0]).toMatch(/^Taxa baziku +\$4\.00$/);
  });

  it('emits a native model-2 QR code (GS ( k) with the payload, and a partial cut', () => {
    const payload = '670S-DIL-BCU-261121-0042';
    const out = bytes(new EscPosBuilder().qr(payload, 6).cut());
    expect(hex(out)).toContain('1d286b0400314132' + '00'); // model 2
    expect(hex(out)).toContain('1d286b03003143' + '06'); // module size 6
    const store = Buffer.concat([Buffer.from([0x1d, 0x28, 0x6b, (payload.length + 3) & 0xff, 0, 0x31, 0x50, 0x30]), Buffer.from(payload)]);
    expect(out.includes(store)).toBe(true);
    expect(hex(out)).toContain('1d286b0300315130'); // print
    expect(hex(out.subarray(out.length - 4))).toBe('1d564200'); // feed + partial cut
  });
});

describe('Localized receipts and labels over HTTP', () => {
  let ctx: TestCtx;
  let net: Network;
  let waybill: string;
  let shipmentId: string;
  let fragile: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    net = await createNetwork(ctx);
    const a = await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId, senderLang: 'pt', insure: true, declared: '300', category: 'ELECTRONICS', description: 'Telemóvel' });
    waybill = a.waybill;
    shipmentId = a.id;
    fragile = (await agentIntake(ctx, net.dili, { destAgentId: net.bcu.agentId, fragile: true, description: 'Vidro' })).waybill;
  });
  afterAll(() => ctx.close());

  const get = (path: string, token = net.dili.token, headers: Record<string, string> = {}) => ctx.http.get(path).set(bearer(token)).set(headers);

  it('prints the receipt in each language with title, fee lines, declaration, liability and claim rule', async () => {
    const expectations: Record<string, string[]> = {
      tet: ['RESIBU HARUKA PAKOTE', 'Taxa baziku', 'Haruka-na\'in deklara', 'dala 10 taxa baziku ka USD 50', 'Klaim estragus'],
      pt: ['GUIA DE ENVIO DE ENCOMENDA', 'Tarifa base', 'O remetente declara', '10x a tarifa base ou USD 50', 'As reclamações por danos'],
      en: ['PARCEL SHIPPING RECEIPT', 'Base fee', 'The sender declares', '10x base fee or USD 50', 'Damage claims must be made'],
      id: ['RESI PENGIRIMAN PAKET', 'Ongkir dasar', 'Pengirim menyatakan', '10x ongkir dasar atau USD 50', 'Klaim kerusakan wajib'],
    };
    for (const [lang, needles] of Object.entries(expectations)) {
      const res = await get(`/v1/shipments/${waybill}/receipt?lang=${lang}`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ lang, widthChars: 32, kind: 'receipt' });
      const text = res.body.text as string;
      for (const n of needles) expect(text.replace(/\n/g, ' ')).toContain(n.replace(/\n/g, ' '));
      for (const line of text.split('\n')) expect(line.length).toBeLessThanOrEqual(32);
      expect(text).toContain(waybill);
      expect(text).toContain('$7.00'); // 4.00 + 3.00 insurance
      expect(text).toContain('$3.00'); // insurance line
      expect(text).toContain('[QR: ' + waybill + ']');
      expect(text).not.toMatch(/\+670 ?77\d{6}/); // phone numbers are masked on paper
    }
  });

  it('defaults to the language of the printing user (X-Lang → saved preference → sender language), switchable by ?lang', async () => {
    expect((await get(`/v1/shipments/${waybill}/receipt`, net.dili.token, { 'X-Lang': 'en' })).body.lang).toBe('en');
    expect((await get(`/v1/shipments/${waybill}/receipt`)).body.lang).toBe('tet'); // user preference (Tetun)
    expect((await get(`/v1/shipments/${waybill}/receipt?lang=id`, net.dili.token, { 'X-Lang': 'en' })).body.lang).toBe('id'); // explicit query wins
    expect((await get(`/v1/shipments/${waybill}/receipt?lang=xx`)).status).toBe(422);
  });

  it('returns raw ESC/POS bytes for the printer, identical to the base64 form', async () => {
    const json = await get(`/v1/shipments/${waybill}/receipt?lang=pt`);
    const raw = await ctx.http.get(`/v1/shipments/${waybill}/receipt?lang=pt&format=escpos`).set(bearer(net.dili.token)).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(raw.headers['content-type']).toContain('application/octet-stream');
    expect((raw.body as Buffer).toString('base64')).toBe(json.body.escposBase64);
    expect((raw.body as Buffer).subarray(0, 2).toString('hex')).toBe('1b40');
    const plain = await get(`/v1/shipments/${waybill}/receipt?lang=en&format=text`);
    expect(plain.headers['content-type']).toContain('text/plain');
    expect(plain.text).toContain('PARCEL SHIPPING RECEIPT');
  });

  it('the label has a large destination, the QR and the seal; fragile parcels get the FRÁJIL sticker', async () => {
    const normal = await get(`/v1/shipments/${waybill}/label`);
    expect(normal.body.kind).toBe('label');
    expect(normal.body.text).toContain('Baucau');
    expect(normal.body.text).toContain(`[QR: ${waybill}]`);
    expect(normal.body.text).toMatch(/SEAL SEG-[0-9A-Z]{8}/);
    expect(normal.body.text).not.toContain('FRAGILE');
    const frag = await get(`/v1/shipments/${fragile}/label`);
    expect(frag.body.text).toContain('FRAJIL');
    expect(frag.body.text).toContain('FRAGILE / MUDAH PECAH');
  });

  it('printing is scoped: strangers get 404; the UUID works as well as the waybill; roles without print rights get 403', async () => {
    const stranger = await createAgent(ctx, 'DIL', '0');
    expect((await get(`/v1/shipments/${waybill}/receipt`, stranger.token)).status).toBe(404);
    expect((await get(`/v1/shipments/${shipmentId}/receipt`)).status).toBe(200);
    expect((await get(`/v1/shipments/${waybill}/receipt`, net.fleet.driver.token)).status).toBe(403);
  });
});

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'use-intl';
import { LOCALES, LOCALE_LABELS, type Locale } from '@670send/types';
import { StateBadge } from '@/components/StatusBadge';
import { Await, Badge, DataTable, ErrorNote, Field, Notice, Page, Section, TabPanel, Tabs } from '@/components/ui';
import { useAction, useCan, useResource } from '@/hooks';
import { useLocaleState } from '@/i18n';
import { contentApi } from '@/lib/endpoints';
import { formatDiliDateTime } from '@/lib/format';
import type { NotificationEvent, NotificationLogRow, TemplateDto, TemplatePreview } from '@/lib/types';

const EVENTS: NotificationEvent[] = ['PICKUP_ASSIGNED', 'DROPPED_AT_ORIGIN', 'CONSOLIDATED_AT_HUB', 'IN_TRANSIT', 'ARRIVED_AT_DEST_AGENT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'ON_HOLD_ISSUE', 'RETURN_TO_SENDER', 'STORAGE_REMINDER_DAY3', 'STORAGE_REMINDER_DAY5'];
const VAR = /\{\{\s*(\w+)\s*\}\}/g;

/** One language of one event: edit, insert variables, preview with sample data, save, reset to the default text. */
function LangEditor({ tpl, onSaved }: { tpl: TemplateDto; onSaved: () => void }) {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const [body, setBody] = useState(tpl.bodyTemplate);
  const [active, setActive] = useState(tpl.isActive);
  const [preview, setPreview] = useState<TemplatePreview | null>(null);
  const [saved, setSaved] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const action = useAction();

  // A new version arrived from the server (after save/reset or when another event is picked).
  useEffect(() => {
    setBody(tpl.bodyTemplate);
    setActive(tpl.isActive);
    setPreview(null);
    setSaved(false);
  }, [tpl.bodyTemplate, tpl.isActive, tpl.eventCode, tpl.lang]);

  const used = useMemo(() => [...body.matchAll(VAR)].map((m) => m[1]!), [body]);
  const unknown = used.filter((v) => !tpl.allowedVariables.includes(v));
  const otpMissing = tpl.eventCode === 'ARRIVED_AT_DEST_AGENT' && active && !used.includes('otp');
  const dirty = body !== tpl.bodyTemplate || active !== tpl.isActive;
  const valid = body.trim().length >= 5 && unknown.length === 0 && !otpMissing;

  function insert(name: string) {
    const el = area.current;
    const token = `{{${name}}}`;
    if (!el) return setBody((b) => b + token);
    const { selectionStart: s, selectionEnd: e } = el;
    const next = body.slice(0, s) + token + body.slice(e);
    setBody(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + token.length, s + token.length);
    });
  }

  return (
    <section className="card space-y-3" aria-label={LOCALE_LABELS[tpl.lang].native} lang={tpl.lang}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="h2">{LOCALE_LABELS[tpl.lang].native}</h3>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {tpl.isDefaultText ? <Badge tone="slate">{t('admin.templates.defaultText')}</Badge> : <Badge tone="brand">{t('admin.templates.customized')}</Badge>}
          {tpl.updatedAt && <span className="text-slate-600">{formatDiliDateTime(tpl.updatedAt, locale)}</span>}
        </div>
      </div>
      <Field label={t('admin.templates.body')} error={unknown.length ? t('admin.templates.unknownVars', { vars: unknown.join(', ') }) : otpMissing ? t('admin.templates.otpRequired') : undefined}>
        {(p) => <textarea {...p} ref={area} className="input min-h-32 font-mono text-sm" value={body} onChange={(e) => { setBody(e.target.value); setSaved(false); }} maxLength={1000} spellCheck />}
      </Field>
      <div className="flex flex-wrap gap-1" aria-label={t('admin.templates.variables')}>
        {tpl.allowedVariables.map((v) => (
          <button key={v} type="button" className="badge bg-brand-50 font-mono text-brand-800 ring-1 ring-brand-200 hover:bg-brand-100" onClick={() => insert(v)}>
            {`{{${v}}}`}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
        {t('admin.templates.active')}
      </label>
      {preview && (
        <div className="rounded-lg bg-emerald-50 p-3 text-sm" aria-live="polite">
          <p className="whitespace-pre-wrap">{preview.text}</p>
          <p className="mt-1 text-xs text-slate-600">{t('admin.templates.length', { count: preview.length })}</p>
        </div>
      )}
      {saved && <Notice tone="ok">{t('admin.templates.saved')}</Notice>}
      {action.error && <ErrorNote>{action.error}</ErrorNote>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-outline btn-sm"
          disabled={action.busy || body.trim().length < 5}
          onClick={async () => {
            let p: TemplatePreview | null = null;
            if (await action.run(async () => (p = await contentApi.previewTemplate(tpl.eventCode, tpl.lang, body)))) setPreview(p);
          }}
        >
          {t('admin.templates.preview')}
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={action.busy || !dirty || !valid}
          onClick={async () => {
            if (await action.run(() => contentApi.saveTemplate(tpl.eventCode, tpl.lang, { ...(body !== tpl.bodyTemplate ? { bodyTemplate: body } : {}), ...(active !== tpl.isActive ? { isActive: active } : {}) }))) {
              setSaved(true);
              onSaved();
            }
          }}
        >
          {t('common.actions.save')}
        </button>
        {!tpl.isDefaultText && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={action.busy}
            onClick={async () => {
              if (await action.run(() => contentApi.resetTemplate(tpl.eventCode, tpl.lang))) onSaved();
            }}
          >
            {t('admin.templates.reset')}
          </button>
        )}
      </div>
    </section>
  );
}

function TemplatesTab() {
  const t = useTranslations();
  const res = useResource((s) => contentApi.templates(s), []);
  const [event, setEvent] = useState<NotificationEvent>('ARRIVED_AT_DEST_AGENT');
  return (
    <Await res={res}>
      {(all) => {
        const byLang = (l: Locale) => all.find((x) => x.eventCode === event && x.lang === l);
        return (
          <div className="space-y-4">
            <div className="card flex flex-wrap items-end gap-3">
              <Field label={t('admin.templates.event')}>
                {(p) => (
                  <select {...p} className="input w-80" value={event} onChange={(e) => setEvent(e.target.value as NotificationEvent)}>
                    {EVENTS.map((x) => (
                      <option key={x} value={x}>
                        {t(`admin.templates.events.${x}`)}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <p className="max-w-xl pb-2 text-sm text-slate-600">{t('admin.templates.intro')}</p>
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
              {LOCALES.map((l) => {
                const tpl = byLang(l);
                return tpl ? <LangEditor key={`${event}-${l}`} tpl={tpl} onSaved={res.reload} /> : null;
              })}
            </div>
          </div>
        );
      }}
    </Await>
  );
}

function LogsTab() {
  const t = useTranslations();
  const { locale } = useLocaleState();
  const [status, setStatus] = useState('');
  const [phone, setPhone] = useState('');
  const res = useResource((s) => contentApi.logs({ status: status || undefined, phone: phone.trim() || undefined, limit: 100 }, s), [status, phone]);
  return (
    <Section title={t('admin.templates.logsTitle')}>
      <div className="card flex flex-wrap items-end gap-3">
        <Field label={t('common.labels.status')}>
          {(p) => (
            <select {...p} className="input w-48" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">{t('admin.common.all')}</option>
              {['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED'].map((s) => (
                <option key={s} value={s}>
                  {t(`admin.state.${s}` as 'admin.state.SENT')}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t('common.labels.phone')} hint={t('admin.templates.phoneHint')}>
          {(p) => <input {...p} className="input w-56" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
        </Field>
      </div>
      <Await res={res} empty={(d: NotificationLogRow[]) => d.length === 0}>
        {(rows) => (
          <DataTable
            caption={t('admin.templates.logsTitle')}
            head={
              <>
                <th>{t('common.labels.date')}</th>
                <th>{t('admin.shipments.waybill')}</th>
                <th>{t('admin.templates.event')}</th>
                <th>{t('admin.templates.to')}</th>
                <th>{t('common.labels.status')}</th>
                <th>{t('admin.templates.message')}</th>
              </>
            }
          >
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{formatDiliDateTime(r.at, locale)}</td>
                <td className="font-mono text-xs">{r.waybill ?? '—'}</td>
                <td>{t(`admin.templates.events.${r.event}` as 'admin.templates.events.DELIVERED')}</td>
                <td>
                  {r.to}
                  <p className="text-xs text-slate-600">
                    {r.audience === 'SENDER' ? t('admin.templates.sender') : t('admin.templates.recipient')} · {r.lang.toLowerCase()}
                  </p>
                </td>
                <td>
                  <StateBadge state={r.status} />
                  {r.retries > 0 && <p className="text-xs text-slate-600">{t('admin.templates.retries', { count: r.retries })}</p>}
                  {r.error && <p className="max-w-40 text-xs text-red-700">{r.error}</p>}
                </td>
                <td className="max-w-md text-xs whitespace-pre-wrap">{r.body}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </Await>
    </Section>
  );
}

/** WhatsApp template editor — every notification in all four languages, with variables, preview and delivery log. */
export function TemplatesScreen() {
  const t = useTranslations();
  const can = useCan();
  const tabs = ([
    { key: 'templates', label: t('admin.templates.tabTemplates'), show: can('templates:manage') },
    { key: 'logs', label: t('admin.templates.tabLogs'), show: can('notification_logs:read') },
  ] as const).filter((x) => x.show);
  const [tab, setTab] = useState<'templates' | 'logs'>('templates');
  const active = (tabs.some((x) => x.key === tab) ? tab : tabs[0]?.key) ?? 'templates';
  return (
    <Page title={t('admin.nav.templates')} subtitle={t('admin.templates.subtitle')}>
      <Tabs tabs={[...tabs]} active={active} onChange={setTab} label={t('admin.nav.templates')} />
      <TabPanel k={active}>{active === 'templates' ? <TemplatesTab /> : <LogsTab />}</TabPanel>
    </Page>
  );
}

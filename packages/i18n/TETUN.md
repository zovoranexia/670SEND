# Tetun Ofisiál — style guide for `src/locales/tet.json`

The Tetun text follows **Tetun Ofisiál** (the standard of the Instituto Nacional de Linguística, INL). When adding or editing a
string, keep to the choices below. They were applied to every Tetun string in the project (web, field app, back office, API errors,
receipts, WhatsApp templates). Have a native speaker review new wording before release.

## Orthography

* One straight apostrophe `'` (ne'ebé, to'o, ki'ik, simu-na'in, haruka-na'in): never `’`. In ICU messages a quote before `{` or `}` must
  stay escaped as in `'{{otp}}'`.
* Acute accent only (no circumflex or tilde): Díli, ónibus, máximu, mínimu, konteúdu, Alfándega.
* Portuguese `qu → k`, `x → ks`, `liq → lik`: eskema, ekspira, eksterna, likidasaun, kiosk.
* `haree` (see), `mós` (also), `labele` (cannot / must not, one word), `liuhusi` (via, one word), `hafoin` (after), `molok` (before).
* Polite "you" is **Ita-boot** (possessive `Ita-boot nia`), not plain `Ita` / `Ita-nia`.

## Preferred terms

| Use | Instead of | Notes |
|-----|-----------|-------|
| estafeta | kurir, kurier | courier |
| kiosk | kios | agent kiosk |
| resibu | resi | receipt / the waybill number a customer sees (`Númeru resibu`); staff screens keep the English term *waybill* |
| karga, karga marítima | kargu, kargu laut | freight (`kargu` means "post / office") |
| feri | ferry, ferri | |
| ónibus | bis | |
| pikap | pickup | |
| saku | sakuk, karung | bag (`Saku mestre` = master bag) |
| lakre | sela, seal | seal on a parcel; the verb is `taka` (close) |
| hahán | aihan | food |
| liafuan-pase | senha, password | |
| korreiu eletróniku | email | |
| telemóvel | telemovel, HP | |
| funsionáriu | staff | |
| motorista | sopir | |
| navegadór | browser | |
| esbosu | rascunhu | draft |
| rejistu | log | audit "log" → `Rejistu auditoria` |
| skan | scan | |
| telefona | telefone (verb) | |
| balansa | timbangan | scale |
| fó | fo | give |

Everything else (hub, KYC, OTP, PIN, ledger, USD, API names) stays as the international term.

# Release checklist

Veřejný release je povolen pouze při splnění všech blokujících položek. „Nefunguje na simulátoru“, „otestujeme po vydání“, omezení poskytovatele nebo chybějící fyzické zařízení nejsou výjimky. Vlastník releasu přiloží důkaz ke každému bodu a zapíše jméno schvalující osoby, commit, buildy a čas.

## 1. Rozsah a produkt

- [ ] Web, mobilní aplikace, API a provozní dokumentace odpovídají [feature-contract.md](feature-contract.md).
- [ ] Všechny funkce jsou zdarma; nejsou aktivní paywally, billing SDK, produkty, subscriptions, premium feature flags ani placené CTA.
- [ ] Limity jsou jednotně 5 profilů na účet a 5 strážců na profil.
- [ ] Interval je 60–10 080 minut včetně a funguje pauza, historie i statistiky.
- [ ] Poloha je volitelná a guardian ji získá pouze při aktivním incidentu.
- [ ] SMS není implementováno ani veřejně slibováno.
- [ ] Veřejné texty netvrdí „okamžité“ nebo garantované doručení ani potvrzený offline check-in.
- [ ] Onboarding a nastavení vysvětlují, že služba nenahrazuje 112/155 a push je best-effort.

## 2. Kritické invarianty backendu

- [ ] Check-in používá serverový čas, transakci a idempotency key.
- [ ] Offline požadavek neposouvá lokálně autoritativní deadline a je viditelně pending.
- [ ] Databáze vynucuje limity a unikátní aktivní incident odolně vůči souběhu.
- [ ] Incident a notification outbox vznikají atomicky.
- [ ] Každý pokus o doručení vytváří `DeliveryAttempt`; funguje backoff, jitter, dead-letter a invalidace tokenu.
- [ ] Scheduler i workery jsou bezpečné při opakování a více instancích.
- [ ] Reconciliation nenachází prošlé profily bez incidentu, incidenty bez outboxu ani neplatné duplicitní incidenty.
- [ ] Push payload neobsahuje polohu, e-mail ani jiné citlivé údaje.
- [ ] Starý Supabase scheduler a nové Django plánování nemohou běžet současně.

## 3. Automatizované ověření

- [ ] Všechny lint, typecheck, unit, integration a build kroky pro monorepo jsou zelené z čistého checkoutu.
- [ ] API schema/contract testy pokrývají web i podporované mobilní buildy.
- [ ] Testy pokrývají všechny řádky AT-01 až AT-24 z feature kontraktu.
- [ ] Property/concurrency testy pokrývají idempotenci, profilové limity, přijetí strážce a tvorbu incidentu.
- [ ] Fault-injection testy pokrývají pád databáze, workeru a push API před i po odeslání.
- [ ] Bezpečnostní testy pokrývají IDOR, odebrání strážce, expiraci session, rate limiting, CSRF webu a autorizaci polohy.
- [ ] Dependency a secret scan jsou bez nevyřešeného critical/high nálezu.
- [ ] Migrační test obnoví anonymizovaný produkčně reprezentativní snapshot do nové verze.

## 4. Povinná testovací matice

### Simulátory/emulátory

- [ ] Aktuální podporovaný iOS simulátor: čistá instalace, upgrade, onboarding, účet, 5 profilů, 5 strážců, interval boundaries, check-in, offline pending/sync, pauza, incident, historie, statistiky a smazání účtu.
- [ ] Aktuální podporovaný Android emulátor: stejný plný scénář.

Simulátory slouží pro deterministické funkční scénáře. Neprokazují spolehlivost push doručení, permission flow, background režimu, úspory baterie ani konkrétního výrobce.

### Fyzická zařízení — nepřeskočitelný release gate

- [ ] Minimálně jeden podporovaný fyzický iPhone s produkčním APNs/Expo credentialem.
- [ ] Minimálně jeden podporovaný fyzický Android s produkčním FCM/Expo credentialem; pokud možno zařízení s agresivním battery managementem.
- [ ] iPhone hlídá profil na Androidu: incident a aktualizace o vyřešení fungují v popředí, pozadí a po ukončení aplikace.
- [ ] Android hlídá profil na iPhonu: stejný scénář.
- [ ] Ověřeny notifikační permission stavy: povoleno, odmítnuto, odebráno v nastavení a focus/do-not-disturb omezení.
- [ ] Ověřeny sítě: Wi-Fi, mobilní data, offline, ztráta spojení během requestu a reconnect po vzniku incidentu.
- [ ] Ověřen restart zařízení, změna času/časové zóny, letní čas, vybití baterie a znovuregistrace push tokenu po reinstalaci.
- [ ] Deep link z push vždy znovu autorizuje vztah; odebraný strážce detail neotevře.

## 5. End-to-end bezpečnostní scénáře

- [ ] Server nedostane check-in → do SLO vznikne jediný incident a outbox pro všech 5 strážců.
- [ ] Check-in na hraně deadline je serializován deterministicky a výsledek je auditovatelný.
- [ ] Pozdní offline synchronizace nezpětně smaže incident.
- [ ] Pauza před deadline nevytvoří incident; pauza po incidentu ho neschová.
- [ ] Provider timeout/429/5xx vede k retry; invalidní token neblokuje ostatní zařízení.
- [ ] Nedostupná push služba ponechá incident i outbox a spustí provozní alarm.
- [ ] Odepřená poloha neblokuje check-in; poloha není dostupná strážci mimo aktivní incident.
- [ ] Zrušení guardian vztahu během incidentu okamžitě odebere přístup.
- [ ] Smazání účtu bezpečně ukončí vztahy a zneplatní sessions bez osiřelých deadline.

## 6. Observabilita a provoz

- [ ] Dashboardy zobrazují SLI/SLO z [architecture.md](architecture.md) a mají ověřená produkční data.
- [ ] Alarmy na zpožděný scheduler, incident gap, stáří outboxu, dead-letter, chybovost API, drift času a neaktuální backup byly vyvolány testem a dorazily dvěma kanály.
- [ ] On-call kontakt, eskalace a vlastník incidentu jsou aktuální; byl proveden tabletop runbooku [runbooks/alert-delivery.md](runbooks/alert-delivery.md).
- [ ] Status page a šablony komunikace neprozrazují osobní údaje a nepředstírají doručení.
- [ ] Error budget za validační období není vyčerpán.
- [ ] Minimálně sedmidenní production-like soak test nevykázal ztracený nebo duplicitní incident.

## 7. Data, backup a obnova

- [ ] Automatické šifrované zálohy a PITR splňují RPO ≤ 15 minut; alert na stale backup funguje.
- [ ] Obnova do izolovaného prostředí byla provedena v posledních 90 dnech a splnila RTO ≤ 4 hodiny.
- [ ] Obnova ověřila referenční integritu, constrainty, kritické county a incident reconciliation.
- [ ] Přístupy k backupům jsou oddělené od produkčních aplikací a je otestovaná rotace klíčů.
- [ ] Retence a bezpečné mazání zahrnují primární DB, logy, analytiku, error reporting a zálohy.

## 8. GDPR, právní a bezpečnostní schválení

- [ ] DPIA je dokončená a schválená před zpracováním reálné polohy a bezpečnostních incidentů.
- [ ] Privacy policy a podmínky popisují skutečný Django/PostgreSQL hosting a všechny subprocessory; nezmiňují Supabase, RevenueCat ani Premium.
- [ ] Je evidován právní titul, účel, rozsah, retence a příjemci pro každý typ dat.
- [ ] DPA a případné SCC jsou uzavřené se všemi zpracovateli; datové regiony jsou zdokumentované.
- [ ] Export, oprava, omezení a výmaz subjektu byly end-to-end otestovány.
- [ ] Security review pokrývá autentizaci, autorizaci, rate limit, správu tajemství, admin přístupy a audit.
- [ ] Kontakty privacy/security a proces hlášení incidentu podle GDPR jsou funkční.
- [ ] App Store privacy labels a Google Play Data safety odpovídají skutečnému toku dat.

## 9. Supabase cutover

- [ ] Všechny kroky a důkazy z [migration/supabase-cutover.md](migration/supabase-cutover.md) jsou uzavřené.
- [ ] Migrace uživatelů, profilů, guardian vztahů, check-inů, incidentů a push tokenů byla nacvičena.
- [ ] Je vyřešena migrace hesel nebo bezpečný reset; sessions jsou řízeně zneplatněné.
- [ ] Je vynucen minimální mobilní build, který používá Django API; staré klienty nelze bezpečnostně provozovat proti Supabase.
- [ ] Final delta má ověřené county, checksumy, vzorky vztahů a deadline reconciliation.
- [ ] Supabase zůstává po schválenou retenční dobu read-only a přístupný jen migračnímu týmu; starý scheduler je vypnutý.

## 10. Release, canary a rollback

- [ ] Je známý poslední bezpečný commit, image digest, schema version a přesný rollback příkaz/postup.
- [ ] Databázové změny jsou expand/contract a rollback aplikace nevyžaduje destruktivní down migration.
- [ ] Scheduler a outbox mají nezávislé kill switche a jejich použití neztrácí incidenty.
- [ ] Canary syntetický profil ověřil check-in, deadline, incident, outbox a push bez produkčních osobních dat.
- [ ] Postupné vydání má definované stop podmínky: jakýkoli incident gap, neočekávaný duplicate, autorizace polohy, chyba migrace nebo nedoručený provozní alarm.
- [ ] Rollback byl nacvičen v production-like prostředí včetně zpracování backlogu po návratu.
- [ ] Po releasu probíhá zvýšený dohled nejméně 24 hodin a reconciliation po každém scheduler okně.

## Podpis release gate

| Role | Jméno | Datum/čas | Důkaz | Schváleno |
|---|---|---|---|---|
| Engineering |  |  |  |  |
| QA iOS |  |  |  |  |
| QA Android |  |  |  |  |
| Backend/SRE |  |  |  |  |
| Security/Privacy |  |  |  |  |
| Product/Legal |  |  |  |  |

Jediné „ne“ nebo chybějící důkaz release blokuje.


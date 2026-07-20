# Runbook: vznik incidentu a doručení upozornění

## Účel

Tento runbook slouží při zpožděném nebo chybějícím incidentu, rostoucím outbox backlogu, chybách push poskytovatele, duplicitách a podezření na neoprávněný přístup k incidentu/poloze. Cílem je zachovat zdroj pravdy, zabránit dalším škodám, obnovit pipeline a doložit, co systém skutečně udělal.

Hlásím se není dispečink a provozovatel z tohoto runbooku nekontaktuje 112/155 jménem uživatele ani netvrdí, že ví, zda je člověk v bezpečí. Podpora smí komunikovat stav služby, ne zdravotní stav osoby.

## Pipeline a stavové významy

1. Scheduler najde aktivní, nepozastavený profil po `next_deadline_at`.
2. Transakce vytvoří právě jeden incident a outbox položky pro tehdejší aktivní strážce.
3. Worker si položku pronajme, odešle push a uloží každý `DeliveryAttempt`.
4. Provider může požadavek přijmout, dočasně odmítnout, trvale odmítnout nebo vrátit receipt. Přijetí providerem není důkazem zobrazení.
5. Pozdní check-in vyřeší incident auditovaným přechodem a vytvoří nové outbox položky s aktualizací.

Nikdy ručně nemažte incident, outbox ani delivery attempts za účelem „opravy dashboardu“.

## Závažnost

| Úroveň | Příklad | Reakce |
|---|---|---|
| SEV-1 | Incidenty nevznikají, incident bez outboxu, neoprávněný přístup k poloze, rozsáhlá ztráta dat, oba schedulery aktivní | Okamžitě; zastavit release, svolat incident tým, status komunikace do 30 min. |
| SEV-2 | Outbox přes SLO, významná chybovost providera/API, dead-letter pro více uživatelů, část platformy bez push | Do 15 min; vlastník a pravidelné aktualizace. |
| SEV-3 | Jednotlivý invalidní token, ojedinělý retry nebo chyba bez porušení SLO | Pracovní doba; sledovat trend a ticket. |

Jakýkoli potvrzený přístup k cizí poloze je současně security/privacy incident a spouští GDPR incident process.

## Povinné dashboardy a alarmy

- `eligible_deadlines_total` vs. `incidents_created_total`
- nejstarší profil po deadline bez incidentu
- počet aktivních incidentů a duplicitně potlačených insertů
- incidenty bez očekávaných outbox položek
- `outbox_pending`, stáří nejstarší položky, `dead_letter_total`
- pokusy podle `provider/platform/result/status_code`
- poměr accepted ticketů a dostupných receipts, nikdy neoznačený jako skutečné doručení
- scheduler heartbeat, worker heartbeat, DB latence, queue depth a clock drift
- poslední úspěšný backup a restore drill

Alarm musí jít alespoň dvěma nezávislými kanály. Push infrastruktura Hlásím se nesmí být jediným kanálem, kterým se hlásí její vlastní výpadek.

## Prvních 10 minut

1. Potvrďte alarm z druhého zdroje a založte incident s UTC časem, severity, incident commanderem a zapisovatelem.
2. Zmrazte deploymenty a konfigurace. Neprovádějte restart bez zachycení metrik, logů, verzí a backlogu.
3. Zkontrolujte rozsah: prostředí, region, platforma, čas prvního výskytu, počet profilů/strážců a zda problém postihuje generování incidentu nebo jen doručení.
4. Ověřte databázi jako zdroj pravdy: způsobilé deadline, incidenty, outbox a attempts. Neusuzujte jen z klientského UI nebo support reportu.
5. Ověřte právě jednoho aktivního schedulera, heartbeat workerů, frontu, DB a veřejný stav Expo/APNs/FCM.
6. Pokud hrozí další ztráta nebo únik, použijte nejmenší bezpečný kill switch podle scénářů níže.
7. U SEV-1/2 publikujte stav služby bez osobních údajů a bez tvrzení, že konkrétní push dorazil.

## Diagnostické dotazy a ochrana dat

Používejte předem reviewované read-only admin příkazy nebo dashboardy. Filtrujte podle opaque incident/profile ID a časového okna. Výstup nevkládejte do veřejných chatů.

Povolená evidence: interní ID, UTC časy, kategorizovaný výsledek, correlation ID, hash tokenu, worker/image version. Zakázaná evidence: heslo, session, celý push token, e-mail, přesná poloha, kompletní payload nebo auth header.

## Scénáře obnovy

### A. Scheduler neběží nebo incidenty nevznikají

1. Ověřte heartbeat, DB spojení, clock drift, poslední úspěšný cursor/lease a změny konfigurace.
2. Potvrďte, že neběží starý Supabase i nový Django scheduler současně.
3. Než restartujete, zaznamenejte nejstarší nezpracovaný deadline a počet způsobilých profilů.
4. Obnovte jedinou scheduler instanci. Algoritmus musí být idempotentní; nespouštějte ad-hoc insert skript.
5. Spusťte standardní gap reconciliation pro celé postižené UTC okno. Ta znovu ověří pause/active stav a vytvoří chybějící incident + outbox atomicky.
6. Ověřte, že pro každý způsobilý deadline vznikl právě jeden incident a žádný pozastavený profil nebyl zasažen.

### B. Incident existuje, ale chybí outbox

Jde o porušení atomického invariantu a SEV-1.

1. Zastavte nové scheduler deploymenty, ne však ukládání check-inů.
2. Ověřte, zda jde o skutečnou mezeru nebo incident bez strážců v okamžiku vzniku.
3. Zachovejte transakční a auditní evidence.
4. Použijte pouze schválenou reconciliation, která deterministicky rekonstruuje recipient snapshot z času incidentu a vytvoří idempotentní outbox položky.
5. Po obnově proveďte RCA databázové transakce a doplňte test selhání.

### C. Outbox backlog nebo worker down

1. Změřte stáří, rychlost přírůstku a rozdělení výsledků; neškálujte naslepo proti rate limitu providera.
2. Ověřte DB lease, queue spojení, expiraci credentials, DNS/TLS, timeouty a provider status.
3. Pokud je provider zdravý, obnovte workery a škálujte v mezích rate limitu. Claim musí používat lease/locking a idempotency key.
4. Zpracovávejte nejstarší bezpečnostní upozornění před nekritickými zprávami; resolution update nesmí předběhnout svůj incident bez jasné sekvenční logiky.
5. Sledujte drain rate do nulového backlogu a ověřte vzorek attempts.

### D. Expo/APNs/FCM má výpadek nebo vrací 429/5xx

1. Potvrďte stav z providera a interního syntetického testu.
2. Ponechte incidenty i outbox v perzistentním stavu. Aplikujte exponenciální backoff s jitterem a respektujte `Retry-After`.
3. Zabraňte retry stormu; případně dočasně otevřete circuit breaker, který zastaví síťové pokusy, ne vznik incidentů.
4. Informujte uživatele přes status page/web/in-app stav, pokud jsou dostupné. Neslibujte konkrétní dobu doručení.
5. Po obnově provideru řízeně vypusťte backlog a zkontrolujte stáří; staré incidenty nemažte jen proto, že notifikace může být opožděná.

### E. Invalidní nebo změněný push token

1. Trvalou provider chybu uložte jako attempt a deaktivujte pouze konkrétní token.
2. Ostatní tokeny uživatele pokračují nezávisle.
3. Aplikace při dalším startu registraci obnoví idempotentně. Uživatel vidí diagnostiku, pokud nemá žádné funkční notifikační zařízení.
4. Token nikdy nekopírujte do ticketu; používejte hash nebo interní device ID.

### F. Podezření na duplicity

1. Rozlište duplicitní incident, duplicitní outbox a opakované provider doručení.
2. Neodstraňujte evidence. Zkontrolujte unikátní klíče incident cycle, recipient/device a provider idempotency/correlation ID.
3. Pokud hrozí notification storm, pozastavte outbox worker kill switchem; scheduler dál perzistuje incidenty.
4. Opravte claim/lease nebo dedupe mechanismus, nasaďte canary a backlog zpracujte řízeně.

Použijte `ALERT_OUTBOX_ENABLED=false` pouze pro alert worker a restartujte jen jeho proces. Nastavení
neclaimuje ani nemění čekající položky a záměrně vytvoří nezdravý heartbeat, který musí mít vlastníka
incidentu. `DEADLINE_SWEEPER_ENABLED=false` je oddělený vypínač vzniku nových incidentů; nevypínejte
jím doručení již perzistovaných alertů. Po obnovení vždy zkontrolujte backlog a spusťte standardní
reconciliation. E-mailová fronta má samostatně `EMAIL_OUTBOX_ENABLED=false`.

### G. Databáze je nedostupná nebo poškozená

1. Zastavte schedulery a workery, aby nevytvářely nekontrolovaný retry load. Klient nesmí zobrazit check-in jako potvrzený.
2. Aktivujte DB failover pouze podle hoster runbooku; ověřte konzistenci a časový bod.
3. Při obnově ze zálohy dodržte RPO ≤ 15 min/RTO ≤ 4 h a nejdřív izolovaně spusťte referenční kontroly.
4. Po návratu proveďte gap reconciliation od posledního prokazatelně committed deadline/check-inu a kontrolu idempotency keys.

### H. Únik nebo neoprávněný přístup k poloze

1. SEV-1: okamžitě zablokujte guardian location endpoint feature flagem, ne celý check-in nebo vznik incidentů.
2. Zachovejte auditní logy a zapojte security/privacy odpovědné osoby.
3. Ověřte rozsah podle autorizovaných requestů a incident activity bez exportu souřadnic.
4. Rotujte dotčené sessions/credentials, opravte autorizaci a před obnovením proveďte negativní testy před incidentem, během něj, po vyřešení a po odebrání strážce.
5. Posuďte ohlašovací povinnost a lhůty podle GDPR incident procesu a DPIA.

## Ruční zásahy

Ruční opakování doručení je povoleno pouze přes auditovaný management postup, který používá existující outbox/idempotency mechanismus. Operátor nesmí sestavovat push payload ručně ani měnit stav na „provider accepted“; ani tento stav není důkaz doručení zařízení.

Ruční vytvoření nebo uzavření incidentu vyžaduje princip čtyř očí, důvod, actor ID a audit event. Nikdy se nesmí zpětně změnit původní deadline, `triggered_at`, attempts nebo recipient snapshot.

## Ověření obnovy

Incident lze uzavřít až když:

- scheduler a workery mají stabilní heartbeat,
- gap reconciliation vrací nulu nevysvětlených chyb,
- neexistují incidenty bez očekávaného outboxu,
- backlog klesl na běžnou úroveň a dead-letter byl jednotlivě posouzen,
- syntetický fyzický iPhone i Android prošly vznikem incidentu, pokusem o push, deep linkem a resolution update,
- authorization test potvrdil, že poloha je dostupná jen během aktivního incidentu,
- alarmy se automaticky vrátily do normálu,
- uživatelská/status komunikace byla aktualizována.

## Komunikace

Příklad bezpečné zprávy:

> Od [UTC čas] evidujeme zpoždění push upozornění. Incidenty a čekající zprávy zůstávají uložené a pracujeme na jejich zpracování. Push notifikace nejsou garantovaný tísňový kanál; v naléhavé situaci kontaktujte přímo 112 nebo 155. Další aktualizace do [čas].

Nikdy neuvádějte počet nebo identitu konkrétních ohrožených osob, polohu, guardian vztah ani formulaci „všichni byli upozorněni“, pokud umíme doložit pouze provider acceptance.

## Po incidentu

Do 48 hodin u SEV-1/2 vytvořte blameless postmortem: dopad, přesnou timeline, detekci, technickou i organizační příčinu, proč ochrany nezabránily dopadu, obnovu, data o SLO/error budgetu a vlastníky nápravných akcí s termíny. Každá oprava přidá automatický test, alarm nebo jasnou runbook změnu. Feature releasy zůstávají zastavené, dokud není spolehlivost v rámci error budgetu a kritická opatření uzavřená.

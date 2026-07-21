# Runbook migrace ze Supabase na Django/PostgreSQL

## Cíl

Převést autentizaci, aplikační data a deadline pipeline ze Supabase do serverově autoritativního Django systému bez ztraceného check-inu, vynechaného nebo duplicitního incidentu, rozbitých guardian vztahů a neoprávněného přístupu k poloze.

Supabase se po cutoveru nepoužívá jako runtime backend. Dočasně zůstane read-only jako auditní a rollback zdroj podle schválené retenční lhůty; poté se bezpečně odstraní.

## Role a rozhodovací pravomoc

Před migrací musí být jmenováni: migration lead, databázový operátor, on-call backendu, mobilní release owner, privacy/security schvalovatel a osoba s pravomocí vyhlásit rollback. Stejná osoba nesmí sama provést i schválit reconciliation.

## Tvrdé předpoklady

- Django datový model, API, scheduler, outbox a delivery attempts splňují architektonické invarianty.
- Minimální mobilní verze používající Django API je vydaná a lze ji vynutit. Staré Supabase klienty nelze po cutoveru nechat vytvářet bezpečnostní stav ve druhém systému.
- Auth migrační strategie je nacvičená na reprezentativním exportu.
- Produkčně ekvivalentní rehearsal prošel včetně deadline na hraně okna, aktivních incidentů, více zařízení a offline front.
- Jsou k dispozici ověřené pre-cutover backupy obou databází a export konfigurace scheduleru/workerů.
- Dashboardy, alarmy, runbook a status komunikace jsou aktivní.
- DPIA, DPA, retence a data residency nového stacku jsou schválené.

Nesplnění kteréhokoli předpokladu znamená `NO-GO`.

## Inventář a mapování

Před implementací exportu vytvořte podepsaný inventář skutečného Supabase schema, RLS policies, RPC, cronů, Edge Functions, auth providerů, storage buckets a secrets. Archivovaný kód není důkazem produkční konfigurace.

Minimální mapování:

| Supabase zdroj | Django cíl | Povinná kontrola |
|---|---|---|
| `auth.users` + `public.users` | uživatel/auth identita | stabilní legacy ID, normalizovaný e-mail, stav ověření, duplicity |
| `check_in_profiles` | profily | vlastník, interval, pause/active, UTC deadline, limity |
| `check_ins` | check-in historie | čas serveru/klienta, offline flag jako metadata, poloha, deduplikace |
| `guardian_invites` | pozvánky | příjemce, stav, expirace; neaktivovat bez přijetí |
| `guardians` | guardian vztahy | obě identity, profil, limit 5, orphan check |
| `alerts` | incidenty | aktivní/vyřešený stav, deadline cyklus, notified guardians |
| `push_tokens` | push zařízení | vlastník, platforma, deduplikace, validita, šifrovaný přenos |
| Edge Function + cron | Django scheduler/outbox | přesné vypnutí starého a zapnutí nového vlastníka |

Každý řádek má transformaci, zdrojový count, cílový count, checksum stabilních polí, počet odmítnutých řádků a schválené vysvětlení. Neplatná data se nesmí tiše zahodit nebo automaticky „opravit“ bez auditního záznamu.

## Migrace autentizace

Password hash se smí importovat jen pokud byl jeho formát, parametry a kompatibilita s Django hasherem ověřen bezpečnostním review a testem přihlášení bez převodu na plaintext. Nikdy se neexportují hesla v čitelné podobě.

Pokud bezpečný hash import není prokazatelný, zvolí se řízený reset hesla:

1. předem informovat uživatele bez odhalení existence konkrétního e-mailu útočníkovi,
2. po cutoveru zneplatnit Supabase sessions,
3. vydat jednorázový, krátce platný reset/magic link přes ověřený kanál,
4. po prvním přihlášení znovu ověřit guardian vztahy a zařízení,
5. rate-limitovat a auditovat obnovu účtu.

Sociální identity se mapují podle ověřeného provider subject, ne pouze podle e-mailu. Duplicitní nebo konfliktní identity blokují cutover, dokud nejsou ručně vyřešené.

## Strategie kompatibility klientů

1. Vydat mobilní build s Django API, idempotency keys, novou offline semantikou a serverovou minimum-version kontrolou.
2. Ověřit adoption a funkční forced-update cestu na iOS i Androidu.
3. Uživatelům s lokální offline frontou zobrazit požadavek připojit se a frontu synchronizovat před oknem. Nelze slíbit zachování nepotvrzených lokálních požadavků, které server nikdy neviděl.
4. Po cutoveru staré buildy bezpečně zablokovat s jasnou aktualizační obrazovkou; nesmí tiše zapisovat do Supabase.
5. Supabase anon/service credentials rotovat až po potvrzení, že nové podporované buildy je nepotřebují a rollback plán s tím počítá.

## Rehearsal

Nejméně dvakrát obnovte aktuální anonymizovaný snapshot do izolace a proveďte celý runbook s měřením doby. Druhý rehearsal musí zahrnout:

- profil s deadlinem před, během a po cutover okně,
- aktivní incident a vyřešený incident,
- pauzu bez konce i s plánovaným koncem,
- 5 profilů a 5 strážců,
- čekající/accepted/declined pozvánky,
- duplicitní push tokeny a více zařízení,
- souběžný check-in na hraně freeze,
- provider timeout a backlog outboxu,
- auth reset nebo hash upgrade,
- úplný rollback.

Rehearsal končí pouze s nulou nevysvětlených rozdílů a s časem uvnitř schváleného maintenance okna.

## Cutover postup

Všechny časy zapisujte v UTC do jednoho sdíleného protokolu. Každý krok má operátora, druhého ověřovatele, začátek, konec, výsledek a odkaz na důkaz.

### Fáze A — T-24 h až T-30 min

1. Vyhlásit změnové okno a zmrazit nesouvisející deploymenty.
2. Ověřit zelené testy, poslední backup, obnovu, dostupnost on-call a stav Expo/APNs/FCM.
3. Pořídit baseline count/checksum všech mapovaných entit a seznam profilů s deadlinem v okně `T-30 min` až `T+30 min`.
4. Zastavit odesílání nových pozvánek a administrativní změny s jasnou hláškou, ale zatím ponechat check-iny.
5. Ověřit vynucení minimálního klienta a zaznamenat zbývající provoz starých verzí.

### Fáze B — Freeze a poslední export

1. Zapnout krátký write freeze pro změny profilu, guardian vztahy a check-iny. Klient musí ukázat „probíhá údržba“, nikdy falešný úspěch; bezpečný offline požadavek zůstává pending.
2. Zaznamenat přesný `T_freeze` a poslední committed transaction/LSN, pokud je dostupný.
3. Nechat doběhnout in-flight Supabase requesty a znovu spočítat baseline.
4. **Vypnout starý Supabase deadline cron/Edge Function** a ověřit z logů i konfigurace, že nemůže znovu běžet. Nezapínat nový scheduler.
5. Pořídit finální konzistentní export a šifrovaný snapshot. Omezit přístup pouze na migrační role.

### Fáze C — Import a validace

1. Importovat identity a ID mapy; konflikty jsou `STOP`, ne varování.
2. Importovat profily, vztahy a pozvánky, potom check-iny, incidenty a zařízení v pořadí cizích klíčů.
3. Zachovat původní UTC deadline. Nevypočítávat je z času importu.
4. U starších dat uchovat `legacy_id` a provenance pro audit, neukazovat je klientovi.
5. Spustit databázové constrainty, orphan kontroly, counts, checksumy a vzorkovou kontrolu kompletních grafů uživatel → profil → strážce → incident.
6. Spustit reconciliation deadline: každý aktivní, nepozastavený profil musí mít právě jeden budoucí deadline nebo aktivní incident podle stavu v `T_freeze`.
7. Pro profily, jejichž deadline uplynul po vypnutí starého scheduleru, vytvořit incident novým atomickým mechanismem právě jednou; zapsat je do zvláštního cutover reportu.

### Fáze D — Aktivace

1. Zapnout Django API pouze pro interní syntetické a migrační účty.
2. Projít canary: login, profil, check-in, pauza, guardian autorizace, incident, outbox, push a vyřešení.
3. Zapnout nový scheduler jako **jediného vlastníka**, potom outbox worker. Ověřit lease/lock a metriky prvního běhu.
4. Otevřít Django API podporovaným klientům a ukončit maintenance režim.
5. Monitorovat každý deadline a outbox v reálném čase minimálně první dvě hodiny; spouštět reconciliation po každém scheduler okně.

### Fáze E — Stabilizace

1. Po 2, 8 a 24 hodinách porovnat očekávané a skutečné incidenty, check-iny, auth chyby a push výsledky.
2. Supabase ponechat read-only, bez scheduleru, Edge Functions a veřejných zápisů.
3. Rotovat Supabase secrets a odebrat runtime přístupy po skončení rollback okna.
4. Po privacy schválené retenční době odstranit exporty i Supabase projekt doložitelným postupem; deletion evidence připojit k migraci.

## Go/no-go a automatický rollback

Okamžitě zastavte aktivaci nebo vyhlašte rollback při kterémkoli z následujících stavů:

- nevysvětlený rozdíl count/checksum nebo orphan vztah,
- profil bez deadline/incidentu nebo více aktivních incidentů,
- starý i nový scheduler aktivní zároveň,
- chyba autorizace umožňující přístup cizímu profilu nebo poloze,
- nefunkční auth významné části testovacích účtů,
- incident bez outboxu, neklesající backlog nebo nefunkční provozní alarm,
- ztracený check-in či falešné potvrzení maintenance/offline akce.

### Rollback před otevřením nových zápisů

1. Nechat Django API zavřené, vypnout nový scheduler a worker.
2. Obnovit starou Supabase konfiguraci ze zaznamenané verze.
3. Zapnout právě jeden starý scheduler a provést gap scan od jeho posledního úspěšného běhu.
4. Zrušit write freeze a ověřit syntetický check-in/incident.

### Rollback po otevření nových zápisů

Po prvním uživatelském zápisu do Django nelze bezpečně pouze přepnout DNS. Je nutné:

1. znovu zapnout maintenance a zastavit oba schedulery/workery,
2. exportovat novou deltu od `T_freeze` včetně idempotency keys a incident/outbox stavů,
3. podle nacvičeného reverse-migration postupu aplikovat deltu do Supabase nebo obnovit opravené Django prostředí,
4. spustit obousměrnou reconciliation check-inů, deadline, incidentů a guardian vztahů,
5. teprve po dvojím schválení aktivovat jediný backend a jediný scheduler.

Pokud reverse migration nebyla předem nacvičená, rollback po zápisech znamená opravit/obnovit Django, nikoli riskovat split-brain návratem na Supabase.

## Evidence po migraci

Migrační balíček obsahuje run log, verze schema a images, anonymizované counts/checksumy, seznam manuálně řešených konfliktů, auth výsledek, deadline gap report, incident/outbox reconciliation, výsledky fyzických zařízení, backup/restore důkaz, seznam rotovaných secrets a podepsané go/no-go rozhodnutí. Neobsahuje hesla, tokeny, e-maily ani souřadnice.


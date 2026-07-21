# Produktový a bezpečnostní kontrakt

Tento dokument je normativní zdroj pro mobilní aplikaci, Django web/API, webový marketing, onboarding, store listing, podporu a akceptační testy. Pokud jsou existující texty nebo implementace v rozporu s tímto dokumentem, nesmí být veřejně vydány, dokud se nesjednotí.

## Neměnné produktové rozhodnutí

Hlásím se je kompletně zdarma. Neexistuje Free/Premium dělení, předplatné, trial, paywall, nákup ani obnova nákupů. Každý účet má bez platby všechny zde uvedené funkce:

- až 5 hlásících se profilů na účet,
- až 5 aktivních strážců na každý profil,
- interval check-inu od 1 hodiny do 7 dní,
- režim pauzy,
- volitelnou polohu při check-inu,
- historii check-inů a statistiky,
- lokální připomínky a best-effort push upozornění strážcům.

SMS upozornění není součástí produktu ani veřejného příslibu. Lze je přidat až po zajištění dlouhodobého financování, návrhu fallback pravidel, souhlasu uživatele a samostatném bezpečnostním a privacy review.

## Slovník stavů

| Termín | Přesný význam |
|---|---|
| Potvrzený check-in | API jej přijalo, uložilo a v odpovědi vrátilo serverový čas a nový termín. |
| Čekající offline požadavek | Akce uložená pouze na zařízení; není důkazem bezpečí a neposunula serverový termín. |
| Deadline | Serverový okamžik, do kterého musí být přijat další check-in. |
| Aktivní incident | Server zjistil prošlý deadline u aktivního, nepozastaveného profilu a incident dosud nebyl vyřešen. |
| Push odeslán | Poskytovatel přijal požadavek nebo vydal ticket; neznamená to doručení či přečtení. |
| Strážce | Uživatel, který výslovně přijal pozvánku ke konkrétnímu profilu. |

## Funkční kontrakt

### Profily a limity

- Účet může současně vlastnit nejvýše 5 nesmazaných profilů. Limit vynucuje server atomicky i při souběžných požadavcích.
- Každý profil může mít nejvýše 5 aktivních strážců. Čekající pozvánky se omezují samostatně proti spamu; přijetí šestého strážce je atomicky odmítnuto.
- Pozvaný uživatel musí vztah přijmout. Vlastník ani administrátor nesmí bez auditované mimořádné procedury vytvořit skrytý vztah.
- Odebrání strážce okamžitě zneplatní jeho přístup k profilu, incidentu a poloze.

### Interval a deadline

- Platný interval je 60 až 10 080 celých minut včetně (1 hodina až 7 dní). API odmítne hodnoty mimo rozsah a necelé minuty.
- Nový nebo obnovený profil dostane deadline `server_now + interval`.
- Potvrzený check-in nastaví deadline na `accepted_at + interval`, kde `accepted_at` je čas serveru.
- Změna intervalu nastaví nový deadline na `server_now + nový_interval`; nesmí zpětně vyvolat incident.
- Zobrazení času respektuje lokální časovou zónu zařízení, ale uložené a porovnávané okamžiky jsou UTC. Přechod letního času nemění délku intervalu.

### Check-in a offline režim

- Úspěch se zobrazí až po potvrzení serverem. Odpověď musí obsahovat stabilní ID check-inu, `accepted_at` a `next_deadline_at`.
- Každý pokus má klientem vytvořený idempotency key. Opakování stejného klíče nevytvoří nový záznam ani neposune deadline podruhé.
- Bez sítě aplikace může požadavek uložit. Musí zobrazit stav „Čeká na připojení — strážci zatím spoléhají na původní termín“ a původní serverový deadline.
- Offline požadavek po synchronizaci dostane aktuální serverový `accepted_at`. Klientský čas je pouze metadata a nesmí zpětně zrušit incident.
- Pokud mezitím vznikl incident, později přijatý check-in incident auditovaně vyřeší a strážcům se odešle aktualizace. Původní incident ani pokusy o doručení se nemažou.
- Marketing nesmí tvrdit „check-in funguje offline“. Povolené tvrzení je: „Bez připojení požadavek bezpečně uložíme a jako potvrzený ho označíme až po spojení se serverem.“

### Pauza

- Pauzu aktivuje vlastník na serveru; lokální nepotvrzený přepínač nemá účinek.
- Během pauzy nevznikají nové incidenty a check-in není vyžadován.
- Pauza automaticky neuzavře již aktivní incident. Uživatel musí incident vyřešit potvrzeným check-inem nebo explicitním bezpečným postupem.
- Obnovení nastaví deadline na `server_now + interval`; za dobu pauzy nevznikají zpětné incidenty.
- UI trvale ukazuje, že je profil pozastavený, a uvádí čas obnovení, pokud byl nastaven. Pauza bez konce je povolená, ale aplikace ji pravidelně připomene.

### Incidenty a upozornění

- Po prošlém deadline vznikne právě jeden aktivní incident na profil a deadline cyklus.
- Incident a všechny odpovídající outbox položky pro tehdejší aktivní strážce vzniknou v jedné transakci.
- Push je best-effort. Aplikace nesmí používat „garantovaně“, „okamžitě doručíme“ ani tvrdit, že push nahrazuje tísňové služby.
- Strážce vidí stav odeslání odděleně od stavu doručení. Není-li receipt dostupný, UI zůstane u „odesláno poskytovateli“, ne „doručeno“.
- Přijetí check-inu po incidentu incident označí jako vyřešený check-inem a vytvoří aktualizační zprávu strážcům.
- Hlásím se samo nekontaktuje 112, 155, policii ani fyzickou dohledovou službu.

### Poloha

- Poloha je volitelná, získává se pouze v popředí po srozumitelném souhlasu při check-inu a její odmítnutí neblokuje check-in.
- Uložit lze polohu pouze k potvrzenému check-inu, včetně času a dostupné přesnosti.
- Strážce smí zobrazit poslední dostupnou polohu pouze během aktivního incidentu. Zobrazení výslovně říká, že jde o poslední známou polohu, nikoli živé sledování.
- Po vyřešení incidentu zaniká guardianův přístup k poloze. Poloha nesmí být v push payloadu, systémových logách, analytice nebo crash reportech a klient ji nesmí uchovat v perzistentní cache.
- Vlastník může podle retenčního kontraktu zobrazit nebo odstranit svou polohu; odstranění nesmí měnit historický fakt, že check-in proběhl.

### Historie a statistiky

- Vlastník vidí chronologickou historii potvrzených check-inů, odděleně označené později synchronizované požadavky, pauzy a incidenty.
- Statistiky se počítají pouze z potvrzených serverových záznamů a zobrazují alespoň počet check-inů, počet včasných check-inů a počet incidentů za zvolené období. Definice metrik musí být dostupná v UI.
- Čekající nebo zamítnutý offline požadavek se nezapočítává jako úspěšný check-in.
- Strážce standardně nevidí kompletní historii ani statistiky vlastníka. Vidí jen informace nutné pro aktuální vztah a aktivní incident.

### Připomínky a zařízení

- Připomínky uživateli jsou lokální best-effort notifikace odvozené z posledního potvrzeného deadline. Po změně deadline se staré připomínky zruší a přepočítají.
- Vypnuté notifikace, úsporný režim, odinstalace, změna tokenu nebo omezení OS mohou upozornění zablokovat. Onboarding a diagnostika nastavení to musí vysvětlovat.
- Uživatel může mít více zařízení. Neplatný token se deaktivuje bez dopadu na ostatní zařízení.

### Účet, data a přístupnost

- Uživatel může exportovat a odstranit účet. Odstranění nejdřív zřetelně vysvětlí dopad na profily, strážce a aktivní incidenty.
- Kritické akce mají textovou i barevnou indikaci, podporují čtečku obrazovky, dynamickou velikost písma a dostatečný kontrast. Check-in nesmí vyžadovat jemné gesto.
- Mobilní i webová aplikace používají stejný serverový kontrakt a stejné názvy stavů.

## Povolená veřejná tvrzení

- „Hlásím se je zdarma a nabízí až 5 profilů a 5 strážců na profil.“
- „Nastavíte si interval od 1 hodiny do 7 dní.“
- „Když server nezaznamená check-in včas, vytvoří incident a pokusí se upozornit strážce push notifikací.“
- „Poloha je volitelná a strážci se zobrazí jen při aktivním incidentu jako poslední známá poloha.“
- „Bez internetu zůstane požadavek čekat v telefonu; potvrzený je až po spojení se serverem.“
- „Hlásím se není tísňová služba a doručení push notifikace nelze garantovat.“

Zakázaná jsou neověřená čísla o zachráněných životech, době příjezdu pomoci nebo zdravotních výsledcích. Jakékoli statistické marketingové tvrzení potřebuje dohledatelný zdroj a právní schválení.

## Traceability: tvrzení → acceptance test

Každý řádek je release gate. Testovací důkazy obsahují build, commit, prostředí, čas, zařízení, výsledek a odkaz na log/screenshot. Automatický test nenahrazuje uvedený test na fyzickém zařízení.

| ID | Produktové tvrzení / invariant | Acceptance test |
|---|---|---|
| AT-01 | Všechny funkce jsou zdarma. | Nový účet na iOS, Androidu a webu projde všechny obrazovky a akce bez paywallu, nabídky nákupu nebo premium claimu; statická kontrola nenajde aktivní billing SDK, product ID ani premium autorizaci. |
| AT-02 | Nejvýše 5 profilů na účet. | API integračně i souběžně vytvoří profily 1–5 a šestý vrátí stabilní validační chybu; stejný výsledek zobrazí web a mobil. |
| AT-03 | Nejvýše 5 strážců na profil. | Pět pozvánek lze přijmout; souběžné přijetí šesté je odmítnuto bez překročení limitu a bez částečného vztahu. |
| AT-04 | Interval je 1 hodina až 7 dní. | Boundary test přijme 60 a 10 080 minut, odmítne 59, 10 081 a necelou minutu; po změně se deadline rovná času serveru plus interval. |
| AT-05 | Server je autorita check-inu. | Se změněným časem telefonu o ±24 hodin vznikne `accepted_at` podle serveru a správný deadline; klient nezobrazí úspěch před 2xx odpovědí. |
| AT-06 | Check-in je idempotentní. | Deset souběžných opakování stejného klíče vytvoří jeden záznam a jeden posun deadline; odpovědi vrátí stejné ID. |
| AT-07 | Offline požadavek není potvrzený check-in. | Na obou platformách vypnout síť, stisknout check-in a ověřit varování i nezměněný serverový deadline; po spojení se stav změní až po odpovědi API. |
| AT-08 | Offline požadavek nezruší zpětně incident. | Na iOS i Androidu při vypnutém API uložit požadavek do SecureStore, nechat konkrétní serverový deadline projít a skutečným schedulerem vytvořit incident; po restartu aplikace musí zůstat pending. Po restartu API synchronizovat a podle shodného profile/generation/incident ID ověřit až následné serverové přijetí, vyřešený UI stav, zachované `incident.opened`/`incident.resolved`/`checkin.confirmed` audity a `alert.opened`/`alert.resolved` outbox eventy. |
| AT-09 | Pauza zabraňuje novým incidentům. | Potvrdit pauzu serverem, posunout testovací čas za deadline a ověřit nulový incident; po obnovení je nový deadline `server_now + interval`, bez retroaktivního incidentu. |
| AT-10 | Pauza neukončí aktivní incident. | Aktivovat incident a poté pauzu; incident zůstane aktivní, dokud neproběhne explicitní řešení. |
| AT-11 | Z prošlého deadline vznikne právě jeden incident. | Spustit více scheduler workerů souběžně a opakovaně; databáze obsahuje jeden incident a správný počet outbox položek. |
| AT-12 | Incident a outbox jsou atomické. | Vložit fault mezi kroky transakce; po rollbacku neexistuje osiřelý incident ani outbox. Reconciliation vrací nulu. |
| AT-13 | Push je retryovatelný a auditovaný. | Simulovat timeout, 429, 5xx, invalid token a úspěch; ověřit backoff, každý `DeliveryAttempt`, invalidaci pouze vadného tokenu a dead-letter alarm. |
| AT-14 | UI netvrdí neprokazatelné doručení. | Provider vrátí ticket bez receipt; web i mobil zobrazí „odesláno poskytovateli“, nikoli „doručeno“. |
| AT-15 | Poloha je volitelná. | Odmítnout oprávnění na čistém iOS a Androidu; check-in uspěje bez souřadnic a bez opakovaného nátlaku. |
| AT-16 | Strážce vidí polohu jen při aktivním incidentu. | Autorizovaný guardian endpoint před incidentem a po vyřešení vrátí 403/404, během incidentu vrátí poslední polohu s časem; jiný uživatel ji nikdy nezíská. |
| AT-17 | Poloha neuniká přes push a telemetrii. | Zachytit push payload, aplikační logy, error reporting a analytiku při incidentu; souřadnice ani adresy se nikde nevyskytují. |
| AT-18 | Historie a statistiky používají potvrzená data. | Vytvořit včasný check-in, incident, offline pending a zamítnutý sync; ověřit chronologii a ručně přepočítat všechny zobrazené metriky. |
| AT-19 | Odebraný strážce ztrácí přístup okamžitě. | Se dvěma souběžnými sessions odebrat strážce a znovu načíst profil, incident a polohu; všechny requesty po commitu jsou odmítnuty. |
| AT-20 | SMS není slibováno ani odesíláno. | Statická kontrola webu, aplikace, store listingů, API a background workerů nenajde claim nebo aktivní SMS integraci. |
| AT-21 | Upozornění funguje end-to-end na fyzických zařízeních. | Reálný iPhone hlídá profil na reálném Androidu a obráceně; aplikace je v popředí, pozadí i ukončená, vznikne incident, push se pokusí doručit a deep link otevře autorizovaný detail. |
| AT-22 | Záloha je obnovitelná. | Obnovit poslední produkčně ekvivalentní backup do izolace, ověřit constrainty, počty, referenční integritu a spustit incident reconciliation. |
| AT-23 | GDPR operace jsou úplné. | Testovací subjekt provede export a odstranění; ověřit rozsah exportu, zneplatnění sessions, odebrání přístupů, retenční tombstone a naplánované odstranění ze záloh. |
| AT-24 | Veřejné texty jsou konzistentní. | Schválený content sweep webu, mobilu, App Store, Google Play, privacy policy, podmínek a launch materiálů nenajde Supabase, Premium, RevenueCat, garantované/okamžité doručení ani „offline check-in je hotový“. |

### Strojový manifest AT-24

Autoritativní seznam verzovaných runtime, store a veřejných README artefaktů je
`scripts/public-contract-manifest.json`. Gate rozbaluje adresáře výhradně nad výstupem
`git ls-files`, takže nezařazené lokální soubory nemohou nepozorovaně změnit rozsah release kontroly
a každý explicitně uvedený soubor nebo adresář musí odpovídat alespoň jednomu trackovanému souboru.

Nový veřejný runtime adresář, store podklad nebo veřejný README musí být do manifestu přidán ve
stejném commitu. Interní migrační, architektonické a testovací podklady do manifestu nepatří; mohou
historické technologie popisovat, ale nesmí být zdrojem veřejného textu. Změnu pravidel ověřují
pozitivní a negativní fixtures příkazem `npm run test:public-contract`; skutečný manifest kontroluje
`npm run check:public-contract`.

Kořenové právní, release a launch dokumenty jsou vedené jako volitelné trackované artefakty. Dokud
nejsou verzované, gate je nevydává za schválené; jakmile se objeví v `git ls-files`, automaticky je
zahrne do stejného obsahového scanu.

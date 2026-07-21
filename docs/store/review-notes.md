# Store review notes

**Stav: DRAFT — NOT READY TO SUBMIT.** Text se upraví o konkrétní build, prostředí a kontakty až před odesláním. Přihlašovací údaje patří výhradně do zabezpečených polí store portálu, nikdy do repozitáře, ticketu ani screenshotu.

## Společné vysvětlení pro review

Hlásím se je bezplatná česká aplikace pro pravidelný check-in. Uživatel může vlastnit až pět profilů a každý profil může mít až pět výslovně přijatých strážců. Když serverový termín uplyne bez přijatého check-inu, backend vytvoří incident a pokusí se upozornit registrovaná zařízení strážců. Incident i historie zůstávají zdrojem pravdy; push není důkaz doručení ani potvrzení stavu člověka.

Poloha je volitelná pro jednotlivý online check-in. Systémové oprávnění v popředí se vyžádá až po zapnutí volby uživatelem. Odmítnutí neblokuje check-in. Poloha se nepřidává do offline fronty a oprávněný strážce ji může vidět pouze během otevřeného incidentu jako poslední známou polohu.

Oprávnění k upozorněním je volitelné. Aplikace nejprve vysvětlí účel, poté zobrazí systémovou žádost. Bez oprávnění zůstávají dostupné základní funkce přímo v aplikaci: check-in, profily, historie a otevření incidentu. Push upozornění a lokální připomínky bez tohoto oprávnění nefungují.

Služba nenahrazuje tísňové ani zdravotnické služby, nepřetržitý dohled ani osobní kontakt. Sama nekontaktuje záchranné složky. V bezprostředním ohrožení má uživatel volat 112 nebo 155.

## Demo účty

### Povinné role

1. **Vlastník profilu** — ověřený syntetický účet s nejméně dvěma profily, jedním přijatým strážcem, historií check-inů a žádnými reálnými osobními údaji.
2. **Strážce** — samostatný ověřený syntetický účet s přijatou vazbou na první účet a přístupem k jednomu bezpečně vytvořenému otevřenému incidentu.

### Deterministický dataset a reset

Review dataset musí obsahovat dva různé profily se shodnými názvy v každém resetu:

- `E2E vlastník – bezpečný check-in` — jediný profil určený pro kroky vlastníka, check-in, polohu, změnu intervalu a pauzu;
- `E2E strážce – aktivní incident` — profil s přijatým strážcem a jedním otevřeným incidentem; vlastník na něm během review nesmí provést check-in, změnit interval, zapnout pauzu ani ho archivovat.

Repozitářový referenční dataset vytváří režim `store-review`:

```bash
cd apps/server
HLASIMSE_E2E_CREDENTIAL='<jednorázově-vygenerované-tajemství-alespoň-32-znaků>' \
  uv run python manage.py seed_e2e --confirm-local-e2e --mode store-review
```

Příkaz je záměrně omezený na `DEBUG` a lokální SQLite nebo loopback PostgreSQL databázi s názvem obsahujícím samostatný segment `e2e` či `test`. Nesmí se obcházet ani spouštět proti produkční databázi. Ve veřejném review prostředí musí schválený provozní postup reprodukovat stejný dataset přes auditované doménové operace a vypsat stejné ne-citlivé postconditions: dvě aktivní profile ID, přesné názvy výše, jeden aktivní guardian vztah, jedno incident ID ve stavu `open` a ověřené přihlášení obou účtů. Přihlašovací tajemství se do výstupu, logu ani repozitáře nezapisuje.

Před prvním odesláním, každým resubmission a po jakémkoli review kroku, který změnil incidentový profil, se provede úplný bounded reset přesných syntetických účtů a znovuvytvoření datasetu. Operátor následně ověří, že check-in na profilu `E2E vlastník – bezpečný check-in` nezmění incident profilu `E2E strážce – aktivní incident`, a uloží pouze ne-citlivý JSON výstup/postconditions jako release důkaz.

### Postup provisioningu

1. V izolovaném review prostředí použít stejnou verzi aplikace a backendu jako pro submission.
2. Účty vytvořit standardním registračním a ověřovacím tokem nebo schváleným produkčním administrativním postupem; nedávat jim staff/admin oprávnění.
3. Vytvořit přesně oddělený bezpečný a incidentový profil podle předchozí sekce. Pozvánku k incidentovému profilu strážce standardně přijme.
4. Pomocí auditovaného testovacího postupu vytvořit otevřený incident pouze na profilu `E2E strážce – aktivní incident`, bez zásahu do reálných uživatelů a bez skryté editace produkčních dat.
5. Ověřit, že účty neexpirují po dobu review, check-in bezpečného profilu incident neuzavře a bounded reset lze zopakovat se stejnými postconditions.
6. E-mail a heslo vložit pouze do příslušného store portálu. V repozitáři smějí zůstat jen tyto zástupné názvy:
   - `<OWNER_REVIEW_EMAIL_FROM_SECRET_STORE>`
   - `<OWNER_REVIEW_PASSWORD_FROM_SECRET_STORE>`
   - `<GUARDIAN_REVIEW_EMAIL_FROM_SECRET_STORE>`
   - `<GUARDIAN_REVIEW_PASSWORD_FROM_SECRET_STORE>`

## Doporučená cesta reviewera

### Účet vlastníka

1. Přihlásit se zadanými review credentials.
2. Na hlavní kartě otevřít přepínač profilů, výslovně zvolit `E2E vlastník – bezpečný check-in` a pouze na něm provést check-in bez polohy.
3. Stále na profilu `E2E vlastník – bezpečný check-in` zapnout volitelnou polohu, projít vysvětlení oprávnění a podle potřeby oprávnění odmítnout; check-in musí zůstat dostupný.
4. Otevřít správu bezpečného profilu, změnit interval a ověřit pauzu/obnovení. Profil `E2E strážce – aktivní incident` neměnit.
5. Otevřít Strážce a zobrazit přijatý vztah.
6. Otevřít Historii a Statistiky.
7. V Nastavení otevřít diagnostiku, export dat a obrazovku výmazu účtu. Review účet prosím nemažte; výmaz je destruktivní a u vlastníka ho blokuje otevřený incident některého z jeho profilů.

### Účet strážce

1. Přihlásit se druhými review credentials.
2. Na kartě Strážci otevřít hlídaný profil `E2E strážce – aktivní incident` a jeho aktivní incident.
3. Prohlédnout serverový termín, stav pokusů o push a případnou syntetickou poslední známou polohu.
4. Použít „Viděl/a jsem incident“. Toto potvrzení incident neuzavře a nekontaktuje další osoby.
5. Ověřit historii přístupných incidentů. Kompletní soukromá historie vlastníka se strážci nezobrazuje.

## Apple App Review Notes — šablona

```text
The app requires sign-in. A non-expiring owner account and a separate guardian account are provided in the secure sign-in fields. Please follow the role-specific steps in the review notes.

Location is optional and requested in the foreground only after the owner enables it for a check-in. Denying location does not block check-in. The guardian can see the last known location only while an authorized incident is open.

Notification permission is optional. Core in-app flows remain available when it is denied: check-in, profile management, history, and opening an incident in the app. Push alerts and local reminders require notification permission and are unavailable when permission is denied. Push delivery is best effort even when permission is granted.

The app is not an emergency or medical service and does not contact emergency responders. Please do not delete the review accounts. For review assistance contact <REVIEW_SUPPORT_EMAIL> or use the Support URL supplied with the store listing.
```

## Google Play App access — šablona

```text
All functionality is behind account sign-in. Use the owner and guardian credentials supplied in the secure App access credential fields. The accounts are already verified and do not require one-time codes.

Owner path: sign in → Check-in → profile switcher → select “E2E vlastník – bezpečný check-in” → check in → Manage profile → Guardians → History → Settings. Do not modify or check in on “E2E strážce – aktivní incident”.
Guardian path: sign in → Guardians → open “E2E strážce – aktivní incident” → open active incident → acknowledge that it was seen.

Location permission is optional and only requested after enabling location for a check-in. Notification permission is optional; push alerts and local reminders require it, while the core in-app flows remain available without it. Do not delete either review account. If seeded state needs to be restored, contact <REVIEW_SUPPORT_EMAIL> or use the Support URL supplied with the store listing.
```

## RELEASE BLOCKERS před vložením poznámek

- `<REVIEW_SUPPORT_EMAIL>` musí být skutečný, sledovaný po celou dobu review a shodný se support stránkou i e-mailem ve store metadatech.
- Review backend musí být dostupný z veřejné sítě bez VPN, IP allowlistu nebo interního DNS.
- Oba účty musí být znovu ověřené po instalaci store buildu na čisté fyzické zařízení.
- Otevřený incident a historie musí být reprodukovatelné bez čekání na dlouhý termín a bez nezdokumentovaného obcházení produkčních invariantů.
- Veřejné review prostředí musí mít schválený, auditovaný ekvivalent lokálního režimu `store-review`; lokální bezpečnostní guard příkazu `seed_e2e` se nesmí oslabit.
- Reviewer nesmí potřebovat přístup k e-mailové schránce, interní administraci, tajnému URL ani jednorázovému kódu.
- Poznámky musí uvádět finální build/version, případné regionální omezení a aktuální kontakt.

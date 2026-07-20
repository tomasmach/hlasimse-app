# Store review notes

**Stav: DRAFT — NOT READY TO SUBMIT.** Text se upraví o konkrétní build, prostředí a kontakty až před odesláním. Přihlašovací údaje patří výhradně do zabezpečených polí store portálu, nikdy do repozitáře, ticketu ani screenshotu.

## Společné vysvětlení pro review

Hlásím se je bezplatná česká aplikace pro pravidelný check-in. Uživatel může vlastnit až pět profilů a každý profil může mít až pět výslovně přijatých strážců. Když serverový termín uplyne bez přijatého check-inu, backend vytvoří incident a pokusí se upozornit registrovaná zařízení strážců. Incident i historie zůstávají zdrojem pravdy; push není důkaz doručení ani potvrzení stavu člověka.

Poloha je volitelná pro jednotlivý online check-in. Systémové oprávnění v popředí se vyžádá až po zapnutí volby uživatelem. Odmítnutí neblokuje check-in. Poloha se nepřidává do offline fronty a oprávněný strážce ji může vidět pouze během otevřeného incidentu jako poslední známou polohu.

Oprávnění k upozorněním je volitelné. Aplikace nejprve vysvětlí účel, poté zobrazí systémovou žádost. Bez oprávnění zůstává možné check-in provést a incident zobrazit po otevření aplikace.

Služba nenahrazuje tísňové ani zdravotnické služby, nepřetržitý dohled ani osobní kontakt. Sama nekontaktuje záchranné složky. V bezprostředním ohrožení má uživatel volat 112 nebo 155.

## Demo účty

### Povinné role

1. **Vlastník profilu** — ověřený syntetický účet s nejméně dvěma profily, jedním přijatým strážcem, historií check-inů a žádnými reálnými osobními údaji.
2. **Strážce** — samostatný ověřený syntetický účet s přijatou vazbou na první účet a přístupem k jednomu bezpečně vytvořenému otevřenému incidentu.

### Postup provisioningu

1. V izolovaném review prostředí použít stejnou verzi aplikace a backendu jako pro submission.
2. Účty vytvořit standardním registračním a ověřovacím tokem nebo schváleným produkčním administrativním postupem; nedávat jim staff/admin oprávnění.
3. Vlastník vytvoří profily a pošle pozvánku strážci. Strážce ji standardně přijme.
4. Pomocí zdokumentovaného testovacího postupu vytvořit otevřený incident bez zásahu do reálných uživatelů. Needitovat skrytě produkční data bez auditní stopy.
5. Ověřit, že účty neexpirují po dobu review a že lze stav bezpečně obnovit po každém testu.
6. E-mail a heslo vložit pouze do příslušného store portálu. V repozitáři smějí zůstat jen tyto zástupné názvy:
   - `<OWNER_REVIEW_EMAIL_FROM_SECRET_STORE>`
   - `<OWNER_REVIEW_PASSWORD_FROM_SECRET_STORE>`
   - `<GUARDIAN_REVIEW_EMAIL_FROM_SECRET_STORE>`
   - `<GUARDIAN_REVIEW_PASSWORD_FROM_SECRET_STORE>`

## Doporučená cesta reviewera

### Účet vlastníka

1. Přihlásit se zadanými review credentials.
2. Na hlavní kartě otevřít přepínač profilů a provést check-in bez polohy.
3. Zapnout volitelnou polohu, projít vysvětlení oprávnění a podle potřeby oprávnění odmítnout; check-in musí zůstat dostupný.
4. Otevřít správu profilu, změnit interval a ověřit pauzu/obnovení.
5. Otevřít Strážce a zobrazit přijatý vztah.
6. Otevřít Historii a Statistiky.
7. V Nastavení otevřít diagnostiku, export dat a obrazovku výmazu účtu. Review účet prosím nemažte; výmaz je destruktivní a může být blokovaný otevřeným incidentem.

### Účet strážce

1. Přihlásit se druhými review credentials.
2. Na kartě Strážci otevřít hlídaný profil a jeho aktivní incident.
3. Prohlédnout serverový termín, stav pokusů o push a případnou syntetickou poslední známou polohu.
4. Použít „Viděl/a jsem incident“. Toto potvrzení incident neuzavře a nekontaktuje další osoby.
5. Ověřit historii přístupných incidentů. Kompletní soukromá historie vlastníka se strážci nezobrazuje.

## Apple App Review Notes — šablona

```text
The app requires sign-in. A non-expiring owner account and a separate guardian account are provided in the secure sign-in fields. Please follow the role-specific steps in the review notes.

Location is optional and requested in the foreground only after the owner enables it for a check-in. Denying location does not block check-in. The guardian can see the last known location only while an authorized incident is open.

Notifications are optional and use best-effort push delivery. All app functionality remains accessible without notification permission by opening the app.

The app is not an emergency or medical service and does not contact emergency responders. Please do not delete the review accounts. For review assistance contact <REVIEW_SUPPORT_EMAIL> or <REVIEW_SUPPORT_PHONE>.
```

## Google Play App access — šablona

```text
All functionality is behind account sign-in. Use the owner and guardian credentials supplied in the secure App access credential fields. The accounts are already verified and do not require one-time codes.

Owner path: sign in → Check-in → profile switcher → Manage profile → Guardians → History → Settings.
Guardian path: sign in → Guardians → open watched profile → open active incident → acknowledge that it was seen.

Location permission is optional and only requested after enabling location for a check-in. Notification permission is optional. Do not delete either review account. If seeded state needs to be restored, contact <REVIEW_SUPPORT_EMAIL> or <REVIEW_SUPPORT_PHONE>.
```

## RELEASE BLOCKERS před vložením poznámek

- `<REVIEW_SUPPORT_EMAIL>` a `<REVIEW_SUPPORT_PHONE>` musí být skutečné, sledované po celou dobu review a shodné se support stránkou.
- Review backend musí být dostupný z veřejné sítě bez VPN, IP allowlistu nebo interního DNS.
- Oba účty musí být znovu ověřené po instalaci store buildu na čisté fyzické zařízení.
- Otevřený incident a historie musí být reprodukovatelné bez čekání na dlouhý termín a bez nezdokumentovaného obcházení produkčních invariantů.
- Reviewer nesmí potřebovat přístup k e-mailové schránce, interní administraci, tajnému URL ani jednorázovému kódu.
- Poznámky musí uvádět finální build/version, případné regionální omezení a aktuální kontakt.

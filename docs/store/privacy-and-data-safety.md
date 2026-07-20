# Privacy Labels a Data Safety

**Stav: DRAFT — RELEASE BLOCKER.** Toto je konzervativní mapování aktuálního kódu, ne hotový právní dokument ani automatické schválení odpovědí ve store formulářích. V den odeslání se musí znovu projít store build, produkční infrastruktura, síťový provoz a SDK.

## Skutečný tok dat

| Data | Zdroj a podmínka | Serverové použití | Příjemci mimo vlastní backend | Propojeno s účtem |
|---|---|---|---|---|
| E-mail | povinný při registraci; také e-mail pozvaného strážce | přihlášení, ověření účtu, bezpečnost a pozvánky | finální SMTP služba — zatím neurčena | ano |
| Jméno uživatele | povinné údaje účtu | identita vlastníka a strážce v uživatelském rozhraní | databázový/hostingový zpracovatel — zatím neurčen | ano |
| Název profilu | zadá uživatel při vytvoření profilu | rozlišení profilů, incidenty, upozornění | push řetězec může dostat název profilu | ano |
| Identifikátory uživatele, profilu a incidentu | vytvoří backend | autorizace, vztahy, idempotence a navigace | push obsahuje pouze nezbytné neprůhledné identifikátory | ano |
| Přesná poloha | volitelně pouze při online check-inu po akci uživatele a oprávnění v popředí | poslední známá poloha potvrzeného check-inu; dostupná oprávněnému strážci jen při otevřeném incidentu | databázový/hostingový zpracovatel — zatím neurčen; není v push payloadu | ano |
| Check-iny, pauzy, historie a incidenty | akce uživatele a autoritativní serverový čas | hlavní funkce, statistiky, auditovatelný stav a bezpečné opakování | databázový/hostingový zpracovatel — zatím neurčen | ano |
| Instalace, platforma a Expo push token | pouze po povolení upozornění a registraci zařízení | směrování push a invalidace neplatného tokenu | Expo a navazující platformní push služba | ano |
| Stav pokusu o doručení a receipt ID | vytvoří worker a push služba | retry, diagnostika a historie pokusů | Expo a navazující platformní push služba | ano |
| Heslo | zadá uživatel přes šifrované spojení | server ukládá pouze bezpečný hash; při přihlášení ověřuje identitu | hostingový zpracovatel; plaintext se nesmí logovat | ano |

Mobilní klient ukládá session, cache profilů a čekající offline požadavky lokálně do chráněného úložiště zařízení. Aktuální runtime polohu do offline fronty nevkládá. Data zpracovaná pouze v zařízení se podle store definic neoznačují jako serverem sbíraná; tato výjimka se musí ověřit proti finálnímu buildu.

Aktuální mobilní závislosti neobsahují reklamní, marketingové ani produktově analytické SDK. Nalezení takového toku v produkčním buildu mění obě níže uvedené deklarace a blokuje release.

## Návrh Apple App Privacy

Odpověď na „Data Collection“: **Yes**.

Pro aktuální funkce navrhuje konzervativní mapování následující datové typy. Všechny jsou použity pro **App Functionality**, jsou **Linked to the User** a nejsou použity pro **Tracking**:

| Apple datový typ | Důvod |
|---|---|
| Contact Info → Name | jméno účtu zobrazené ve vztazích vlastníka a strážce |
| Contact Info → Email Address | účet, přihlášení, ověření a pozvánky |
| Location → Precise Location | volitelná souřadnice potvrzeného check-inu |
| Identifiers → User ID | identita účtu a autorizované vztahy |
| Identifiers → Device ID | identifikátor instalace a push token navázaný na účet |
| User Content → Other User Content | uživatelem zadané názvy profilů a obsah potřebný pro vztahy |
| Usage Data → Product Interaction | check-in, pauza, potvrzení incidentu a další funkční události |

Podle aktuálního kódu se nedeklarují platby, nákupy, kontakty z adresáře, zdravotní data, reklama ani tracking. Toto tvrzení neřeší automaticky technické IP/logy infrastruktury; jejich skutečný rozsah musí doplnit finální provozovatel.

Privacy Policy URL z [metadata-cs.md](metadata-cs.md) je povinná. Zda bude k dispozici i samostatný odkaz Privacy Choices, je právní a produktové rozhodnutí.

## Návrh Google Play Data Safety

Odpověď na sběr dat: **Yes**. Všechny účely jsou omezené na „App functionality“, „Account management“ a tam, kde to formulář dovoluje, „Security, fraud prevention, and compliance“.

| Google datový typ | Povinnost pro uživatele | Účel |
|---|---|---|
| Personal info → Name | povinné pro účet | zobrazení identity a správa vztahů |
| Personal info → Email address | povinné pro účet | přihlášení, ověření, bezpečnost a pozvánky |
| Personal info → User IDs | povinné | autorizace a hlavní funkce |
| Location → Precise location | volitelné pro jednotlivý check-in | poslední známá poloha při otevřeném incidentu |
| App activity → Other actions | povinné pro využití funkcí | check-in, pauza, incident, potvrzení a statistiky |
| Device or other IDs | volitelné; vzniká po povolení push | registrace zařízení a směrování upozornění |
| App activity → Other user-generated content | povinné při vytvoření profilu | uživatelské názvy profilů a vazby strážců |

### Sdílení dat — RELEASE BLOCKER

Do třetích stran tečou alespoň údaje potřebné pro e-mail, push a provoz databáze. Google umožňuje některé přenosy z odpovědi „sharing“ vyjmout, pokud příjemce jedná pouze jako service provider jménem vývojáře. Odpověď „No data shared“ lze zvolit až po ověření finálních smluv, účelů dodavatelů, jejich dalšího použití a celé SDK/síťové inventury. Do té doby je pole neuzavřené.

### Šifrování při přenosu — RELEASE BLOCKER

Produkční konfigurace vyžaduje HTTPS pro aplikaci a TLS pro e-mail. „Data is encrypted in transit“ lze potvrdit až po nasazení a nezávislém ověření produkčního endpointu, e-mailového toku a spojení ke všem poskytovatelům.

### Výmaz dat — RELEASE BLOCKER

Mobilní aplikace obsahuje cestu Nastavení → Smazat účet. Server výmaz nepovolí během otevřeného incidentu, aby nebyl obcházen bezpečnostní stav. Google navíc vyžaduje veřejný webový zdroj, přes který lze výmaz zahájit; cílová šablona je `https://<production-domain>/ucet/smazat/`. Pole lze uzavřít až po nasazení a review testu této stránky.

## Retence, výmaz a export

Aktuální runtime umožňuje:

- export JSON s účtem, profily, check-iny včetně případné polohy, vztahy a pozvánkami strážců, incidenty a identifikátory registrovaných zařízení; provider tokeny se do exportu nevkládají;
- trvalý výmaz vlastního účtu po bezpečném uzavření otevřených incidentů;
- při výmazu odstranění vlastněných profilů a jejich dat, vztahů, pozvánek, zařízení a navázaného doručovacího stavu;
- anonymizaci identity smazaného příjemce v incidentech jiných vlastníků, aby nezůstalo jeho jméno nebo e-mail a zároveň se neporušila historie incidentu;
- odstranění polohy konkrétního check-inu na webu bez odstranění zbytku historického záznamu;
- pseudonymní bezpečnostní auditní událost po výmazu účtu; model auditních metadat zakazuje jméno, e-mail, polohu, token a tajemství.

Kód neurčuje schválené časové lhůty pro běžná data, vyřešené incidenty, doručovací pokusy, audit, aplikační/infrastrukturní logy ani zálohy. Do jejich stanovení se pracovní technický stav popisuje jako uchování do uživatelského výmazu nebo explicitního lifecycle kroku; to není dostatečná veřejná retenční politika. Konkrétní lhůty, propagace výmazu do replik a záloh a maximální doba obnovitelnosti jsou **RELEASE BLOCKER**.

## Kontrola před odesláním

- Zachytit síťový provoz přesného release buildu na obou platformách a porovnat každý hostname s tabulkou.
- Zkontrolovat binární SDK/SBOM, oprávnění a manifesty, ne pouze `package.json`.
- Prověřit produkční logy na e-mail, jméno, souřadnice, tokeny a payloady.
- Doplnit dodavatele, regiony, účely, smluvní role a retenční lhůty do privacy policy.
- Porovnat odpovědi s aktuálním zněním obou store formulářů a uložit screenshot/export formuláře jako release důkaz.

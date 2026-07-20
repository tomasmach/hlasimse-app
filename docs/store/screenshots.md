# Screenshot storyboard

**Stav: DRAFT.** Snímky se pořizují zvlášť na skutečném iPhone buildu a skutečném Android buildu. Nesmí se jen vložit stejný mockup do dvou rámečků.

## Společná režie

- Použít release-candidate build napojený na izolované prostředí se syntetickými českými jmény a časově stabilními daty.
- Zachytit skutečné UI aplikace bez designového domalování funkce, která v buildu není.
- Skrýt e-mail, souřadnice, push token, interní ID, debug overlay, URL testovacího serveru a systémové notifikace s cizími údaji.
- Status bar musí mít čistý čas, plnou síť a baterii; zařízení nesmí ukazovat osobní účet ani jméno operátora testera.
- Textový overlay může zkrátit vysvětlení, ale nesmí měnit význam serverového potvrzení, offline fronty, incidentu, polohy nebo push doručení.
- Pro Google grafiku nepoužívat cenové promo, pořadí v žebříčku, výzvu ke stažení ani tvrzení o ocenění. Vizuál má ukázat produkt.
- Každý výsledný obrázek projde kontrolou při 100% zvětšení a kontrolou čitelnosti na cílovém zařízení.

## Storyboard

| # | Obrazovka a skutečný stav | Navržený overlay | Alt text do 140 znaků | Runtime zdroj |
|---|---|---|---|---|
| 1 | Hlavní check-in s aktivním profilem a serverovým termínem | `Včasné potvrzení bez nejistoty` | `Hlavní obrazovka s profilem, zbývajícím časem a tlačítkem Hlásím se.` | `apps/mobile/app/(tabs)/index.tsx`, `checkin-submit` |
| 2 | Přepínač dvou profilů; poté detail s intervalem a pauzou | `Až 5 profilů, každý podle vás` | `Přepínání profilů a správa intervalu od jedné hodiny do sedmi dnů.` | `index.tsx`, `profile-switcher`; `profile-detail.tsx` |
| 3 | Odpojené zařízení s jedním čekajícím požadavkem | `Offline požadavek čeká na server` | `Offline banner jasně označuje čekající check-in, který ještě neposunul termín.` | `OfflineBanner.tsx`, `offline-queue-sync` |
| 4 | Strážci profilu, jedna přijatá vazba a jedna čekající pozvánka | `Blízcí mají přístup jen po přijetí` | `Seznam strážců a pozvánka, kterou musí pozvaný člověk přijmout.` | `guardians.tsx`, `guardian-invite-open` |
| 5 | Otevřený incident s best-effort stavem doručení a bez citlivé polohy | `Zmeškaný termín zůstává dohledatelný` | `Detail aktivního incidentu s termínem, stavem pokusů o upozornění a potvrzením strážce.` | `incident/[id].tsx`, `incident-acknowledge` |
| 6 | Historie a statistiky za vybrané období | `Historie podle serverového času` | `Statistiky a časová osa potvrzených check-inů, pauz a incidentů.` | `activity.tsx`, `statistics-section`, `history-section` |
| 7 | Nastavení s diagnostikou, exportem a výmazem | `Oprávnění a data máte pod kontrolou` | `Nastavení nabízí diagnostiku upozornění a polohy, export dat a výmaz účtu.` | `settings.tsx`, `notification-diagnostics-open`, `account-export-open`, `account-delete-open` |

Snímek 5 má variantu s poslední známou polohou jen tehdy, pokud lze použít zcela syntetické souřadnice a obrázek současně jasně ukazuje aktivní incident. Jinak se použije stav „Poloha není dostupná“.

## iPhone capture set

- Pořídit všech sedm scénářů na aktuálním podporovaném fyzickém iPhonu ze stejného produkčně podepsaného kandidáta jako push testy.
- V App Store Connect vytvořit povinnou sadu pro aktuálně vyžadovanou velikost displeje; přesné rozměry a případné škálování ověřit v den nahrání podle aktuální nabídky portálu.
- Nepoužívat Android navigaci ani falešný iPhone rámeček. Oprávnění k poloze a upozornění musí mít skutečné iOS znění, pokud jsou součástí snímku.

## Android capture set

- Pořídit všech sedm scénářů na aktuálním podporovaném fyzickém Android zařízení ze stejného produkčně podepsaného kandidáta jako push testy.
- Připravit 9:16 snímky alespoň 1080 px na kratší straně; Google doporučuje nejméně čtyři kvalitní telefonní snímky a dovoluje až osm.
- Nepoužívat iOS status bar ani gesta. Pokud je vidět systémové oprávnění, musí pocházet z testované Android verze.

## Feature graphic pro Google Play

- Rozměr 1024 × 500 px.
- Vlevo nebo uprostřed ponechat bezpečný prostor pro ořez a překryvy portálu.
- Použít logo, klidný produktový motiv a maximálně krátkou značkovou větu; nedávat screenshot zmenšený do nečitelné koláže.
- Finální grafika musí být odvozena z aktuálního vizuálního systému aplikace a projít samostatným brand review.

## Screenshot release gate

- Každý stav byl během capture session reprodukován testovacím scénářem, ne ruční editací databáze bez záznamu.
- U každého souboru je evidována platforma, zařízení, OS, build, commit, backend prostředí, čas a tester.
- Český text prošel jazykovou korekturou a porovnáním s [metadata-cs.md](metadata-cs.md).
- Reviewer potvrdil, že snímky neslibují živé sledování, nepřetržité hlídání ani jistotu doručení push.
- Obrázky neobsahují reálné osobní údaje ani souřadnice.

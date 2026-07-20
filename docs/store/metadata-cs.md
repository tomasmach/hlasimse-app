# České store metadata

**Stav: DRAFT.** Texty odpovídají [produktovému kontraktu](../feature-contract.md) a aktuálnímu runtime. Do store portálů se kopírují až po uzavření blockerů v [README.md](README.md).

## Společné hodnoty

| Pole | Hodnota | Limit / poznámka |
|---|---|---|
| Název aplikace | `Hlásím se` | Apple: 9/30 znaků |
| Apple subtitle | `Pravidelný check-in pro blízké` | 30/30 znaků |
| Google short description | `Pravidelný check-in, incidenty a upozornění pro vaše blízké.` | 60/80 znaků |
| Apple promotional text | `Pravidelný check-in pro vás a vaše blízké. Až 5 profilů, 5 strážců na profil, pauza, historie a volitelná poloha. Všechny funkce jsou zdarma.` | 141/170 znaků |
| Apple keywords | `check-in,rodina,senioři,strážce,bezpečí,připomínka,cestování,samostatnost` | 82/100 UTF-8 bajtů; bez mezer |
| Cena | Bezplatné stažení; všechny produktové funkce zdarma | Žádné předplatné ani nákup v aplikaci |
| Primární jazyk | čeština (`cs-CZ`) | Lokalizace dalších jazyků není součástí tohoto balíčku |

Kategorie je produktové rozhodnutí pro den odeslání. Předvyplnění bez kontroly aktuálních store možností je **RELEASE BLOCKER**.

## Long description

Hlásím se pomáhá lidem pravidelně potvrdit, že jsou v pořádku, a dává jejich blízkým přehled o zmeškaném termínu. Hodí se pro člověka žijícího o samotě, rodinu, samostatné cestování i pobyt mimo běžnou rutinu.

Všechny funkce jsou zdarma:

- až 5 vlastních check-in profilů na jeden účet
- až 5 strážců u každého profilu
- interval check-inu od 1 hodiny do 7 dnů
- termín potvrzený serverem po úspěšném check-inu
- pauza profilu, historie a přehledné statistiky
- pozvánky strážců, které musí druhá osoba výslovně přijmout
- incident po zmeškaném serverovém termínu a pokus o push upozornění strážců
- přehled stavu doručení a potvrzení, že strážce incident viděl
- volitelná přesná poloha pouze při vybraném check-inu
- lokální připomínky v zařízení a diagnostika oprávnění
- export vlastních dat a žádost o trvalý výmaz účtu

Když je telefon bez připojení, požadavek na check-in může počkat pouze v zařízení. Termín se změní až po přijetí serverem. Neodeslaný nebo odmítnutý požadavek není potvrzený check-in.

Poloha není povinná a její odmítnutí check-in nezablokuje. Pokud ji při check-inu zapnete, oprávněný strážce ji uvidí pouze během aktivního incidentu jako poslední známou polohu. Nejde o živé sledování.

Hlásím se není tísňová ani zdravotnická služba, nehlídá člověka nepřetržitě a samo nekontaktuje záchranné složky. Push upozornění závisí na internetu, nastavení telefonu a externích službách, takže jeho doručení nelze zaručit. V bezprostředním ohrožení volejte 112 nebo 155.

## URL pole — RELEASE BLOCKERS

Následující hodnoty jsou záměrně pouze šablony. Nesmí se odeslat, dokud příslušná stránka neběží veřejně přes HTTPS a její obsah není ověřený:

| Store pole | Hodnota k doplnění |
|---|---|
| Marketing URL | `https://<production-domain>/` |
| Support URL | `https://<production-domain>/podpora/` |
| Privacy policy URL | `https://<production-domain>/soukromi/` |
| Account deletion URL pro Google Play | `https://<production-domain>/ucet/smazat/` |
| Support e-mail | `<support-email-on-production-domain>` |

Support stránka musí obsahovat skutečný způsob kontaktu. Privacy stránka musí popisovat finální provoz a zpracovatele. Webový výmaz musí být veřejně dohledatelný, jasně označený pro Hlásím se a funkční pro přihlášeného uživatele.

## Textová pravidla pro další lokalizace

- Používat pouze schopnosti přítomné v odesílaném buildu a produkčním API.
- Incident popisovat jako serverový záznam zmeškaného termínu, nikoli jako důkaz stavu člověka.
- Push popisovat jako pokus o upozornění, jehož doručení závisí na zařízení, síti a externích službách.
- Offline stav vždy označit jako čekající požadavek, dokud jej server nepřijme.
- Polohu popisovat jako volitelnou poslední známou polohu, ne jako živé sledování.
- Všechny funkce prezentovat jako bezplatné bez časově omezené nabídky.

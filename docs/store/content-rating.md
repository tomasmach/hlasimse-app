# Obsahové a věkové hodnocení

**Stav: DRAFT — RELEASE BLOCKER.** App Store i Google Play odvozují výsledek z aktuálního dotazníku a regionu. Do formuláře se zadávají skutečnosti níže; konkrétní číslo ratingu se před výpočtem portálu nepředpovídá.

## Faktický obsah aplikace

| Oblast | Skutečný stav |
|---|---|
| Násilí, krev, grafický nebo děsivý obsah | není součástí produktu |
| Sexualita nebo nahota | není součástí produktu |
| Alkohol, tabák nebo drogy | nejsou součástí produktu |
| Hazard, soutěže nebo loot boxy | nejsou součástí produktu |
| Hrubý jazyk | není součástí produktu |
| Reklama | aplikace ji nezobrazuje |
| Nákupy v aplikaci | nejsou součástí produktu |
| Veřejný uživatelský obsah, feed nebo chat | nejsou součástí produktu |
| Neomezený webový prohlížeč | není součástí produktu; případný mapový odkaz otevírá konkrétní souřadnici externě |
| Zdravotní diagnóza, léčba nebo odborná rada | aplikace je neposkytuje |
| Poloha | volitelná poslední známá poloha check-inu, nikoli veřejné nebo živé sledování |
| Bezpečnostní témata | textové upozornění na zmeškaný termín, odkazy na 112/155 a jasné omezení služby; bez grafického obsahu |

## Rationale pro review

Aplikace je nástroj pravidelného potvrzení a sdílení omezeného stavu mezi předem přijatými účty. Neobsahuje veřejnou komunikaci ani moderovaný obsah. Incident je technický záznam zmeškaného serverového termínu, nikoli zdravotní závěr. Odkaz na tísňové linky a bezpečnostní vysvětlení jsou preventivní instrukce, ne simulace násilí nebo zdravotnická funkce.

Podle tohoto inventáře nejsou přítomné běžné kategorie závadného obsahu. Jediným platným výsledkem ale zůstává rating vypočtený po pravdivém vyplnění aktuálního Apple a IARC dotazníku.

## Cílová skupina — RELEASE BLOCKER

Produkt není navržen jako dětská služba a registrace vyžaduje samostatný účet a práci s bezpečnostním vztahem. Finální věkové minimum, target audience, případný parental gate a soulad s právem však musí určit product/legal před odesláním. Tato volba se nesmí odvodit pouze z pravděpodobně nízkého obsahového ratingu.

## Kontrola v den odeslání

- Projít každou otázku v portálu proti přesnému release buildu, store textům a webu.
- Ověřit, zda systém nezobrazuje uživatelsky zadaný název profilu v push; pokud ano, stále nejde o veřejný obsah, ale je nutné pravdivě odpovědět na příslušnou otázku.
- Uložit export nebo screenshot vyplněného dotazníku a výsledné regionální ratingy jako release důkaz.
- Každá pozdější funkce komunikace, webového obsahu, reklamy nebo zdravotních doporučení vyžaduje nové hodnocení.

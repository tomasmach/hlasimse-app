# Mobile release gate

Publikace mobilních aplikací je záměrně rozdělena na deterministickou kontrolu repozitáře a na credentialed kontrolu finálně podepsaných artefaktů. Úspěšné běžné CI samo o sobě nikdy neznamená, že lze aplikaci odeslat do obchodů.

## Běžné CI

`npm run check:mobile-native-config` kontroluje zdrojovou Expo konfiguraci a `npm run test:release-gates` regresní testy validátorů. Tyto kroky nevyžadují Apple ani Google přihlašovací údaje a běží na každém pull requestu.

## Ruční candidate gate

Workflow `Mobile release candidate gate` se spouští ručně. Tři nezávislé joby:

1. odmítnou `DRAFT`, placeholdery, nefinální právní URL, neodpovídající identity/verze a chybějících sedm screenshotů pro každou platformu nebo Play feature graphic; stav `READY` navíc provede živý GET bez redirectu na marketing, podporu, ochranu soukromí, podmínky i veřejný postup výmazu a vyžaduje HTTP 2xx, HTML a neprázdný obsah bez release-blockeru;
2. pomocí Expo CNG vytvoří Android release AAB, ověří ZIP integritu a přítomnost zkompilovaného base manifestu a porovná identitu, verzi a oprávnění ve finálním Gradle merged release manifestu s přesným allowlistem v `scripts/release/native-release-policy.json`;
3. na macOS znovu vygenerují iOS projekt a ověří bundle ID, verzi, build number, ATS a výsledný `PrivacyInfo.xcprivacy` proti deklaraci v `app.json`.

Lokálně lze stejné kroky spustit:

```bash
npm run test:release-gates
npm run check:store-release-pack
npm run release:android-candidate
npm run release:ios-candidate
```

Android candidate je úmyslně podepsaný standardním Android debug certifikátem. Slouží jen k reprodukovatelné kontrole obsahu AAB a **nesmí se publikovat**. iOS krok v tomto gate kontroluje vygenerovanou native konfiguraci, nikoli distribuční archive.

App-target `PrivacyInfo.xcprivacy` musí přesně obsahovat produktové deklarace z `app.json` a nesmí přidat žádné accessed-API důvody. Závislosti dodávají vlastní privacy manifesty; jejich výslednou agregaci Apple nástroji lze spolehlivě zkontrolovat až ve finálním archive a patří proto do externího gate níže.

## Poslední externí gate před publikací

Pro každou konkrétní verzi musí release operátor mimo PR CI:

- vytvořit finální Android AAB podepsaný upload klíčem, znovu ověřit application ID, version code, SHA-256 a přesný permission allowlist a nahrát jej do uzavřeného Play test tracku;
- vytvořit iOS Archive distribuční identitou, ověřit bundle ID, marketing version, build number, podpis/provisioning a privacy manifest a nahrát jej do TestFlightu;
- provázat hashe/build čísla podepsaných artefaktů se schváleným `docs/store/release-pack.json`;
- potvrdit, že nasazený `LEGAL_TERMS_VERSION` přesně označuje neměnnou schválenou verzi podmínek dostupnou na URL v release packu; při každé obsahové změně podmínek použít novou verzi;
- dokončit store review na obou platformách. Žádná výjimka ani ruční „approve despite failure“ není přípustná.

Dokud je `docs/store/release-pack.json` ve stavu `DRAFT`, obsahuje `com.anonymous.*`, nejsou vloženy produkční HTTPS URL nebo chybí store assety, candidate workflow musí skončit chybou.

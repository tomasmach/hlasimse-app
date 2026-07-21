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

Produkční store build je definovaný v `apps/mobile/eas.json`. Používá finální identitu
`cz.tomasmach.hlasimse`, vzdálené automatické číslování buildu a neměnný HTTPS endpoint
`https://www.hlasimse.cz`. Android build vyžaduje `GOOGLE_SERVICES_JSON` jako EAS file variable;
`apps/mobile/app.config.js` produkční build bez tohoto Firebase vstupu odmítne. Statickou část
profilu ověří `npm run check:mobile-release-config`, konkrétní Firebase soubor pak:

```bash
node scripts/release/validate-eas-config.mjs \
  --firebase /absolute/restricted/path/google-services.json
```

EAS CLI musí odpovídat přesné verzi uvedené v `eas.json`. Build ani submit se nespouští
automaticky:

```bash
cd apps/mobile
npm run release:build
npm run release:submit:android
npm run release:submit:ios
```

Submit profily záměrně směrují Android nejprve do interního tracku ve stavu draft a iOS nechávají
vyžádat App Store Connect aplikaci od přihlášeného operátora. Žádný příkaz nepoužívat, dokud
neprojde celý checklist a nejsou odděleně potvrzené účty, signing identity a store záznamy.

Android candidate je úmyslně podepsaný standardním Android debug certifikátem. Slouží jen k reprodukovatelné kontrole obsahu AAB a **nesmí se publikovat**. iOS krok v tomto gate kontroluje vygenerovanou native konfiguraci, nikoli distribuční archive.

App-target `PrivacyInfo.xcprivacy` musí přesně obsahovat produktové deklarace z `app.json` a nesmí přidat žádné accessed-API důvody. Závislosti dodávají vlastní privacy manifesty; jejich výslednou agregaci Apple nástroji lze spolehlivě zkontrolovat až ve finálním archive a patří proto do externího gate níže.

## Poslední externí gate před publikací

Pro každou konkrétní verzi musí release operátor mimo PR CI:

- vytvořit finální Android AAB podepsaný upload klíčem, znovu ověřit application ID, version code, SHA-256 a přesný permission allowlist a nahrát jej do uzavřeného Play test tracku;
- vytvořit iOS Archive distribuční identitou, ověřit bundle ID, marketing version, build number, podpis/provisioning a privacy manifest a nahrát jej do TestFlightu;
- provázat hashe/build čísla podepsaných artefaktů se schváleným `docs/store/release-pack.json`;
- potvrdit, že nasazený `LEGAL_TERMS_VERSION` přesně označuje neměnnou schválenou verzi podmínek dostupnou na URL v release packu; při každé obsahové změně podmínek použít novou verzi;
- dokončit store review na obou platformách. Žádná výjimka ani ruční „approve despite failure“ není přípustná.

Podepsané AAB a IPA/xcarchive projdou před nahráním strojovým auditem popsaným v
[`final-native-artifact-audit.md`](final-native-artifact-audit.md). Spouští se přes
`npm run release:audit-native -- ...`; dílčí výsledek vždy zůstává `releaseEligible=false`, dokud
nejsou doložené store instalace, fyzická zařízení a ostatní release gates.

Poslední společný gate čte `docs/release/readiness-manifest.json`. Stav `READY` přijme pouze tehdy,
když manifest odpovídá přesnému commitu a tree, hashi store balíčku a image digestu a obsahuje
hashe runtime contractu, runtime gate, Trivy reportu, release manifestu, Cosign signature a
attestation bundles, evidence indexu a nahraného serverového evidence artefaktu. Tyto hodnoty se
kopírují pouze z artefaktu vytvořeného úspěšným během `publish-server-artifact.yml`; ručně vytvořené
nebo přepsané release tagy nejsou přípustné. Manifest dále vyžaduje neprázdné hashe externích důkazů
pro migraci, právní schválení, restore, paging, SMTP, soak test, podepsané artefakty,
TestFlight/Play closed track, čistou instalaci, N-1 upgrade, produkční API, fyzická zařízení a
skutečný push včetně receipt reconciliation. Ověření spustí
`npm run check:release-readiness`; tracked manifest zůstává `DRAFT`, dokud tyto kroky reálně
neproběhnou.

Dokud je `docs/store/release-pack.json` ve stavu `DRAFT`, neodpovídá finální identitě
`cz.tomasmach.hlasimse`, nejsou vloženy produkční HTTPS URL nebo chybí store assety, candidate
workflow musí skončit chybou.

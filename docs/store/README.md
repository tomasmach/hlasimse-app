# Store submission pack

**Stav: DRAFT — NOT READY TO SUBMIT.** Tento adresář je pracovní zdroj pravdivých českých podkladů pro App Store a Google Play. Nejde o schválení releasu ani o náhradu právní kontroly.

## Obsah

- [metadata-cs.md](metadata-cs.md) — názvy, krátké a dlouhé texty, klíčová slova a URL pole.
- [screenshots.md](screenshots.md) — storyboard a pravidla pro skutečné iPhone a Android snímky.
- [privacy-and-data-safety.md](privacy-and-data-safety.md) — návrh Apple Privacy Labels a Google Play Data Safety podle runtime toku dat.
- [content-rating.md](content-rating.md) — podklad pro věkové a obsahové dotazníky.
- [review-notes.md](review-notes.md) — poznámky pro review a postup přípravy demo účtů bez přihlašovacích údajů v repozitáři.

Normativním produktovým zdrojem je [feature-contract.md](../feature-contract.md). Release lze povolit pouze podle [release-checklist.md](../release-checklist.md). Datové mapování v tomto balíčku bylo porovnáno s aktuálními modely, API účtu, mobilním check-inem, registrací zařízení a push workerem. Před každým odesláním formulářů se kontrola musí zopakovat proti přesnému store buildu a produkční konfiguraci.

## RELEASE BLOCKERS

Dokud nejsou uzavřené všechny následující body, nejsou metadata ani privacy formuláře připravené k odeslání:

- finální produkční doména a veřejné HTTPS adresy marketingového webu, podpory, privacy policy a webového zahájení výmazu účtu;
- identita provozovatele, právní kontakty a skutečný support e-mail/telefon uvedený na cílové support stránce;
- finální iOS bundle ID, Android application ID, názvy vývojářských účtů a podepsané produkční buildy;
- výběr hostingu aplikace, PostgreSQL, SMTP, záloh a logů včetně regionů, rolí zpracovatelů, smluv a případných mezinárodních přenosů;
- ověření rolí Expo, APNs a FCM v konečných smlouvách a privacy dokumentaci; bez něj nelze uzavřít odpověď na sdílení dat;
- schválené retenční lhůty pro databázi, doručovací historii, audit, aplikační a infrastrukturní logy a zálohy;
- veřejná, přesná a právně schválená privacy policy odpovídající finální infrastruktuře;
- funkční export a výmaz účtu ověřený end-to-end v produkční konfiguraci, včetně webového odkazu na zahájení výmazu;
- důkaz šifrování přenosu, obnovy záloh, fyzických push testů a všech ostatních položek release gate;
- finální cílová věková skupina a odpovědi v aktuálních store dotaznících;
- dva syntetické, nepriviligované review účty připravené podle [review-notes.md](review-notes.md), uložené pouze do zabezpečených polí store portálů.

Hodnoty závislé na hostingu, dodavatelích nebo právním rozhodnutí se nesmí doplnit odhadem.

## Oficiální zdroje polí a formulářů

Ověřeno 20. 7. 2026 pouze proti oficiální dokumentaci. Store portály a jejich formuláře se mohou měnit; vlastník releasu je musí znovu projít v den odeslání.

### Apple

- [App information](https://developer.apple.com/help/app-store-connect/reference/app-information/app-information/) — název, podtitul a privacy policy URL.
- [Platform version information](https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information) — screenshots, promotional text, description, keywords, support URL a údaje pro App Review.
- [App privacy details](https://developer.apple.com/app-store/app-privacy-details/) — datové typy, účely, propojení s identitou, tracking a data třetích stran.
- [Manage app privacy](https://developer.apple.com/help/app-store-connect/manage-app-information/manage-app-privacy) — správa odpovědí a povinná privacy URL.
- [Set an app age rating](https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/) a [age-rating definitions](https://developer.apple.com/help/app-store-connect/reference/app-information/age-ratings-values-and-definitions) — povinný dotazník a regionální výsledky.

### Google Play

- [Create and set up your store listing](https://support.google.com/googleplay/android-developer/answer/9866151?hl=en) a [store listing best practices](https://support.google.com/googleplay/android-developer/answer/13393723?hl=en-EN) — textové limity, grafické podklady a pravdivost prezentace.
- [Data Safety](https://support.google.com/googleplay/android-developer/answer/10787469?hl=en) — sběr, sdílení, účely, šifrování a výmaz včetně knihoven třetích stran.
- [Prepare your app for review](https://support.google.com/googleplay/android-developer/answer/9859455?hl=en) — privacy policy, přístup do aplikace a obsahová prohlášení.
- [Account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111?hl=en) a [User Data policy](https://support.google.com/googleplay/android-developer/answer/10144311?hl=en) — výmaz v aplikaci i přes veřejný webový zdroj a obsah privacy policy.
- [Content ratings](https://support.google.com/googleplay/android-developer/answer/9859655?hl=en_EN) — povinný IARC dotazník a regionální hodnocení.
- [Play Console requirements](https://support.google.com/googleplay/android-developer/answer/10788890?hl=en) — aktivní demo přístup a další zdroje potřebné pro review.
- [Create and set up your app](https://support.google.com/googleplay/android-developer/answer/9859152?hl=en) — bezplatná distribuce a povinný support e-mail.

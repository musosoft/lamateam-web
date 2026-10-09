export const locales = ["cs", "sk", "pl", "hu", "de", "uk", "fr"] as const;
export type Locale = (typeof locales)[number];
export const pageKinds = [
  "home",
  "connect",
  "rules",
  "maps",
  "commands",
  "money",
  "hitreg",
  "fixes",
  "speed",
  "sourcetv",
  "admins",
  "vip",
  "contact",
] as const;
export type PageKind = (typeof pageKinds)[number];
export type SiteLocale = Locale | "en";
export const allLocales = ["en", ...locales] as const;
/** Stable public URL contract. English page identifiers remain content keys and
 * legacy aliases; only these slugs are emitted by navigation and SEO. */
export const localizedSlugs = {
  cs: {
    home: "",
    connect: "pripojeni",
    rules: "pravidla",
    maps: "mapy",
    commands: "prikazy",
    money: "penize",
    hitreg: "registrace-zasahu",
    fixes: "opravy",
    speed: "rychlost",
    sourcetv: "sledovani-hry",
    admins: "spravci",
    vip: "vip-vyhody",
    contact: "kontakt",
  },
  sk: {
    home: "",
    connect: "pripojenie",
    rules: "pravidla",
    maps: "mapy",
    commands: "prikazy",
    money: "peniaze",
    hitreg: "registracia-zasahov",
    fixes: "opravy",
    speed: "rychlost",
    sourcetv: "sledovanie-hry",
    admins: "spravcovia",
    vip: "vip-vyhody",
    contact: "kontakt",
  },
  pl: {
    home: "",
    connect: "polaczenie",
    rules: "zasady",
    maps: "mapy",
    commands: "komendy",
    money: "pieniadze",
    hitreg: "rejestracja-trafien",
    fixes: "naprawy",
    speed: "predkosc",
    sourcetv: "ogladanie-gry",
    admins: "administratorzy",
    vip: "korzysci-vip",
    contact: "kontakt",
  },
  hu: {
    home: "",
    connect: "csatlakozas",
    rules: "szabalyok",
    maps: "palyak",
    commands: "parancsok",
    money: "penz",
    hitreg: "talalatregisztracio",
    fixes: "javitasok",
    speed: "sebesseg",
    sourcetv: "jatekkozvetites",
    admins: "adminisztratorok",
    vip: "vip-elonyok",
    contact: "kapcsolat",
  },
  de: {
    home: "",
    connect: "verbinden",
    rules: "regeln",
    maps: "karten",
    commands: "befehle",
    money: "geld",
    hitreg: "trefferregistrierung",
    fixes: "fehlerbehebung",
    speed: "geschwindigkeit",
    sourcetv: "spieluebertragung",
    admins: "administratoren",
    vip: "vip-vorteile",
    contact: "kontakt",
  },
  uk: {
    home: "",
    connect: "pidkliuchennia",
    rules: "pravyla",
    maps: "karty",
    commands: "komandy",
    money: "hroshi",
    hitreg: "reiestratsiia-vluchan",
    fixes: "vypravlennia",
    speed: "shvydkist",
    sourcetv: "transliatsiia-hry",
    admins: "administratory",
    vip: "vip-perevahy",
    contact: "kontakty",
  },
  fr: {
    home: "",
    connect: "connexion",
    rules: "regles",
    maps: "cartes",
    commands: "commandes",
    money: "argent",
    hitreg: "enregistrement-des-tirs",
    fixes: "correctifs",
    speed: "vitesse",
    sourcetv: "diffusion-du-jeu",
    admins: "administrateurs",
    vip: "avantages-vip",
    contact: "nous-contacter",
  },
} as const satisfies Record<Locale, Record<PageKind, string>>;

/** Resolve only a locale's canonical slug or its original English alias. */
export function pageFromSlug(
  locale: SiteLocale,
  slug: string,
): PageKind | undefined {
  return pageKinds.find(
    (page) =>
      page !== "home" &&
      (page === slug ||
        (locale !== "en" && localizedSlugs[locale][page] === slug)),
  );
}
export function localeFromPath(path: string): SiteLocale {
  const candidate = path.split("/")[1];
  return isLocale(candidate) ? candidate : "en";
}
export const serverAddress = "82.208.17.101:27516";
export const discordUrl = "https://discord.com/invite/2tvWZhuSaG";
export function isLocale(value: string | undefined): value is Locale {
  return locales.some((locale) => locale === value);
}
export function equivalentPage(path: string): PageKind | undefined {
  if (!path.startsWith("/") || path.includes("//") || /[?#\\]/.test(path))
    return undefined;
  const segments = path.split("/").filter(Boolean);
  const locale = localeFromPath(path);
  if (locale !== "en") segments.shift();
  if (segments.length === 0) return "home";
  if (segments.length === 1) return pageFromSlug(locale, segments[0]);
}
export function localePath(locale: Locale | "en", page: PageKind): string {
  return locale === "en"
    ? page === "home"
      ? "/"
      : `/${page}`
    : `/${locale}/${page === "home" ? "" : `${localizedSlugs[locale][page]}/`}`;
}
/** Compatibility window: retain all old localized English aliases with a 308.
 * HTTP requests do not carry fragments; browsers inherit the original fragment
 * when Location has none. URL callers also retain any available fragment. */
export function legacyLocaleRedirect(url: URL): string | undefined {
  const locale = localeFromPath(url.pathname);
  if (locale === "en") return undefined;
  const page = equivalentPage(url.pathname);
  if (!page || page === "home") return undefined;
  const slug = url.pathname.split("/")[2];
  if (slug !== page) return undefined;
  return localePath(locale, page) + url.search + url.hash;
}
export const routeManifest = pageKinds.flatMap((page) =>
  allLocales.map((locale) => ({
    page,
    locale,
    path: localePath(locale, page),
  })),
);
export const untranslatedPublicRoutes = [
  "/banlist",
  "/bans",
  "/stats",
] as const;
export function localizedHref(href: string, locale: SiteLocale): string {
  if (!href.startsWith("/") || href.startsWith("//")) return href;
  const url = new URL(href, "https://lamateam.eu");
  const page = equivalentPage(url.pathname);
  return page ? localePath(locale, page) + url.search + url.hash : href;
}
export function siteUrl(
  value: string | undefined = import.meta.env?.PUBLIC_SITE_URL,
): string {
  return value || "https://lamateam.eu";
}
export interface LocalizedContent {
  homeTitle: string;
  homeDescription: string;
  welcome: string;
  intro: string;
  connectTitle: string;
  connectDescription: string;
  join: string;
  requirements: string;
  privacy: string;
  steamHeading: string;
  steamStep: string;
  launch: string;
  consoleHeading: string;
  consoleStep: string;
  command: string;
  favoritesHeading: string;
  favoritesStep: string;
  help: string;
  rules: string;
  languageRule: string;
  chat: string;
  home: string;
}
export const content: Record<Locale, LocalizedContent> = {
  cs: {
    homeTitle: "LaMaTeAm — komunita Counter-Strike: Source",
    homeDescription:
      "LaMaTeAm: evropský komunitní server CS:S. Adresa serveru, návod k připojení a Discord.",
    welcome: "Vítejte na LaMaTeAm.",
    intro:
      "Evropský server Counter-Strike: Source pro českou a slovenskou komunitu. Klasické mapy a férová hra.",
    connectTitle: "Připojení | LaMaTeAm CS:S",
    connectDescription:
      "Připojte se na LaMaTeAm CS:S přes Steam, herní konzoli nebo Oblíbené.",
    join: "Připojit se na LaMaTeAm",
    requirements:
      "Potřebujete Steam a nainstalovaný Counter-Strike: Source (nikoli CS2).",
    privacy:
      "Ke hře nepotřebujete přihlášení na webu. Přihlášení přes Steam na webu slouží pouze pro chat.",
    steamHeading: "1. Spusťte Steam a připojte se",
    steamStep:
      "Přihlaste se v aplikaci Steam a použijte tlačítko. Pokud vás prohlížeč požádá, povolte otevření Steamu. Pokud se nic nestane, spusťte CS:S z knihovny a použijte konzoli.",
    launch: "Spustit CS:S a připojit se",
    consoleHeading: "2. Nebo použijte herní konzoli",
    consoleStep:
      "V CS:S otevřete Options → Keyboard → Advanced a povolte vývojářskou konzoli. Otevřete ji klávesou ~ pod Esc, vložte příkaz a stiskněte Enter. Pokud ~ nefunguje, zkontrolujte přiřazení Toggle console v nastavení klávesnice.",
    command: "Příkaz do konzole",
    favoritesHeading: "3. Uložte server do Oblíbených",
    favoritesStep:
      "V CS:S otevřete Find Servers → Favorites → Add a Server. Zadejte adresu níže, přidejte server, vyberte jej a klikněte na Connect.",
    help: "Nelze se připojit? Zkontrolujte adresu, připojení a instalaci i aktualizace CS:S. Nedostupný server zkuste později. Chybovou zprávu můžete sdílet na Discordu.",
    rules: "Pravidla serveru",
    languageRule:
      "Pravidla hry povolují jazyky CZ/SK/EN. Jazyk webu toto pravidlo nemění.",
    chat: "Komunitní chat na anglické hlavní stránce",
    home: "Úvod",
  },
  sk: {
    homeTitle: "LaMaTeAm — komunita Counter-Strike: Source",
    homeDescription:
      "LaMaTeAm: európsky komunitný server CS:S. Adresa servera, návod na pripojenie a Discord.",
    welcome: "Vitajte na LaMaTeAm.",
    intro:
      "Európsky server Counter-Strike: Source pre českú a slovenskú komunitu. Klasické mapy a férová hra.",
    connectTitle: "Pripojenie | LaMaTeAm CS:S",
    connectDescription:
      "Pripojte sa na LaMaTeAm CS:S cez Steam, hernú konzolu alebo Obľúbené.",
    join: "Pripojiť sa na LaMaTeAm",
    requirements:
      "Potrebujete Steam a nainštalovaný Counter-Strike: Source (nie CS2).",
    privacy:
      "Na hranie sa nemusíte prihlásiť na webe. Prihlásenie cez Steam na webe slúži iba pre chat.",
    steamHeading: "1. Spustite Steam a pripojte sa",
    steamStep:
      "Prihláste sa v aplikácii Steam a použite tlačidlo. Ak vás prehliadač požiada, povoľte otvorenie Steamu. Ak sa nič nestane, spustite CS:S z knižnice a použite konzolu.",
    launch: "Spustiť CS:S a pripojiť sa",
    consoleHeading: "2. Alebo použite hernú konzolu",
    consoleStep:
      "V CS:S otvorte Options → Keyboard → Advanced a povoľte vývojársku konzolu. Otvorte ju klávesom ~ pod Esc, vložte príkaz a stlačte Enter. Ak ~ nefunguje, skontrolujte priradenie Toggle console v nastavení klávesnice.",
    command: "Príkaz do konzoly",
    favoritesHeading: "3. Uložte server do Obľúbených",
    favoritesStep:
      "V CS:S otvorte Find Servers → Favorites → Add a Server. Zadajte adresu nižšie, pridajte server, vyberte ho a kliknite na Connect.",
    help: "Nedá sa pripojiť? Skontrolujte adresu, pripojenie a inštaláciu aj aktualizácie CS:S. Nedostupný server skúste neskôr. Chybovú správu môžete zdieľať na Discorde.",
    rules: "Pravidlá servera",
    languageRule:
      "Pravidlá hry povoľujú jazyky CZ/SK/EN. Jazyk webu toto pravidlo nemení.",
    chat: "Komunitný chat na anglickej hlavnej stránke",
    home: "Úvod",
  },
  pl: {
    homeTitle: "LaMaTeAm — społeczność Counter-Strike: Source",
    homeDescription:
      "LaMaTeAm: europejski serwer społeczności CS:S. Adres serwera, instrukcja dołączenia i Discord.",
    welcome: "Witaj w LaMaTeAm.",
    intro:
      "Europejski serwer Counter-Strike: Source dla czeskiej i słowackiej społeczności. Klasyczne mapy i uczciwa gra.",
    connectTitle: "Dołącz | LaMaTeAm CS:S",
    connectDescription:
      "Dołącz do LaMaTeAm CS:S przez Steam, konsolę gry lub Ulubione.",
    join: "Dołącz do LaMaTeAm",
    requirements:
      "Potrzebujesz Steam i zainstalowanego Counter-Strike: Source (nie CS2).",
    privacy:
      "Nie musisz logować się na stronie, aby grać. Logowanie przez Steam na stronie służy tylko do czatu.",
    steamHeading: "1. Otwórz Steam i dołącz",
    steamStep:
      "Zaloguj się w aplikacji Steam i użyj przycisku. Zezwól przeglądarce na otwarcie Steam, jeśli o to poprosi. Jeśli nic się nie dzieje, uruchom CS:S z biblioteki i użyj konsoli.",
    launch: "Uruchom CS:S i dołącz",
    consoleHeading: "2. Lub użyj konsoli gry",
    consoleStep:
      "W CS:S otwórz Options → Keyboard → Advanced i włącz konsolę deweloperską. Otwórz ją klawiszem ~ pod Esc, wklej polecenie i naciśnij Enter. Jeśli ~ nie działa, sprawdź przypisanie Toggle console w ustawieniach klawiatury.",
    command: "Polecenie konsoli",
    favoritesHeading: "3. Zapisz serwer w Ulubionych",
    favoritesStep:
      "W CS:S otwórz Find Servers → Favorites → Add a Server. Wpisz poniższy adres, dodaj serwer, wybierz go i kliknij Connect.",
    help: "Nie możesz dołączyć? Sprawdź adres, połączenie oraz instalację i aktualizacje CS:S. Jeśli serwer jest niedostępny, spróbuj później. Udostępnij komunikat o błędzie na Discordzie.",
    rules: "Zasady serwera",
    languageRule:
      "Zasady gry dopuszczają języki CZ/SK/EN. Język strony nie zmienia tej zasady.",
    chat: "Czat społeczności na angielskiej stronie głównej",
    home: "Strona główna",
  },
  hu: {
    homeTitle: "LaMaTeAm — Counter-Strike: Source közösség",
    homeDescription:
      "LaMaTeAm: európai CS:S közösségi szerver. Szervercím, csatlakozási útmutató és Discord.",
    welcome: "Üdv a LaMaTeAm oldalán!",
    intro:
      "Európai Counter-Strike: Source szerver a cseh és szlovák közösség számára. Klasszikus pályák és tisztességes játék.",
    connectTitle: "Csatlakozás | LaMaTeAm CS:S",
    connectDescription:
      "Csatlakozz a LaMaTeAm CS:S szerverhez Steamen, a játék konzolján vagy a Kedvenceken keresztül.",
    join: "Csatlakozás a LaMaTeAmhez",
    requirements:
      "Steam és telepített Counter-Strike: Source szükséges (nem CS2).",
    privacy:
      "A játékhoz nem kell bejelentkezned a weboldalon. A weboldal Steam-bejelentkezése csak a csevegéshez szükséges.",
    steamHeading: "1. Nyisd meg a Steamet, és csatlakozz",
    steamStep:
      "Jelentkezz be a Steam alkalmazásba, majd használd a gombot. Ha a böngésző kéri, engedélyezd a Steam megnyitását. Ha nem történik semmi, indítsd el a CS:S-t a könyvtárból, és használd a konzolt.",
    launch: "CS:S indítása és csatlakozás",
    consoleHeading: "2. Vagy használd a játék konzolját",
    consoleStep:
      "A CS:S-ben nyisd meg az Options → Keyboard → Advanced menüt, és engedélyezd a fejlesztői konzolt. Nyisd meg az Esc alatti ~ billentyűvel, illeszd be a parancsot, majd nyomj Entert. Ha a ~ nem működik, ellenőrizd a Toggle console billentyűt a beállításokban.",
    command: "Konzolparancs",
    favoritesHeading: "3. Mentsd a szervert a Kedvencekhez",
    favoritesStep:
      "A CS:S-ben nyisd meg a Find Servers → Favorites → Add a Server menüt. Írd be az alábbi címet, add hozzá a szervert, válaszd ki, majd kattints a Connect gombra.",
    help: "Nem sikerül csatlakozni? Ellenőrizd a címet, a kapcsolatot és a CS:S telepítését, frissítéseit. Ha a szerver nem érhető el, próbáld később. A hibaüzenetet megoszthatod Discordon.",
    rules: "Szerverszabályok",
    languageRule:
      "A játékszabályok a CZ/SK/EN nyelveket engedélyezik. A weboldal nyelve ezen nem változtat.",
    chat: "Közösségi csevegés az angol főoldalon",
    home: "Főoldal",
  },
  de: {
    homeTitle: "LaMaTeAm — Counter-Strike: Source Community",
    homeDescription:
      "LaMaTeAm: europäischer CS:S-Communityserver. Serveradresse, Anleitung zum Beitritt und Discord.",
    welcome: "Willkommen bei LaMaTeAm.",
    intro:
      "Ein europäischer Counter-Strike: Source Server für die tschechische und slowakische Community. Klassische Maps und faires Spiel.",
    connectTitle: "Verbinden | LaMaTeAm CS:S",
    connectDescription:
      "Verbinde dich mit LaMaTeAm CS:S über Steam, die Spielkonsole oder Favoriten.",
    join: "Mit LaMaTeAm verbinden",
    requirements:
      "Du brauchst Steam und eine installierte Version von Counter-Strike: Source (nicht CS2).",
    privacy:
      "Zum Spielen ist keine Anmeldung auf der Website nötig. Die Steam-Anmeldung auf der Website ist nur für den Chat.",
    steamHeading: "1. Steam öffnen und beitreten",
    steamStep:
      "Melde dich in der Steam-App an und nutze den Button. Erlaube dem Browser bei Nachfrage, Steam zu öffnen. Passiert nichts, starte CS:S aus deiner Bibliothek und nutze die Konsole.",
    launch: "CS:S starten und verbinden",
    consoleHeading: "2. Oder die Spielkonsole nutzen",
    consoleStep:
      "Öffne in CS:S Options → Keyboard → Advanced und aktiviere die Entwicklerkonsole. Öffne sie mit ~ unter Esc, füge den Befehl ein und drücke Enter. Funktioniert ~ nicht, prüfe die Belegung von Toggle console in den Tastatureinstellungen.",
    command: "Konsolenbefehl",
    favoritesHeading: "3. In den Favoriten speichern",
    favoritesStep:
      "Öffne in CS:S Find Servers → Favorites → Add a Server. Gib die Adresse unten ein, füge den Server hinzu, wähle ihn aus und klicke auf Connect.",
    help: "Verbindung klappt nicht? Prüfe Adresse, Verbindung sowie Installation und Updates von CS:S. Ist der Server nicht erreichbar, versuche es später. Teile die Fehlermeldung im Discord.",
    rules: "Serverregeln",
    languageRule:
      "Die Spielregeln erlauben CZ/SK/EN. Die Sprache der Website ändert diese Regel nicht.",
    chat: "Communitychat auf der englischen Startseite",
    home: "Startseite",
  },
  uk: {
    homeTitle: "LaMaTeAm — спільнота Counter-Strike: Source",
    homeDescription:
      "LaMaTeAm: європейський сервер спільноти CS:S. Адреса сервера, інструкція підключення та Discord.",
    welcome: "Вітаємо в LaMaTeAm.",
    intro:
      "Європейський сервер Counter-Strike: Source для чеської та словацької спільноти. Класичні карти та чесна гра.",
    connectTitle: "Підключення | LaMaTeAm CS:S",
    connectDescription:
      "Підключіться до LaMaTeAm CS:S через Steam, консоль гри або Обране.",
    join: "Підключитися до LaMaTeAm",
    requirements:
      "Потрібні Steam і встановлена гра Counter-Strike: Source (не CS2).",
    privacy:
      "Для гри не потрібно входити на сайт. Вхід через Steam на сайті потрібен лише для чату.",
    steamHeading: "1. Відкрийте Steam і підключіться",
    steamStep:
      "Увійдіть у застосунок Steam і натисніть кнопку. Дозвольте браузеру відкрити Steam, якщо він запитає. Якщо нічого не відбувається, запустіть CS:S з бібліотеки та скористайтеся консоллю.",
    launch: "Запустити CS:S і підключитися",
    consoleHeading: "2. Або скористайтеся консоллю гри",
    consoleStep:
      "У CS:S відкрийте Options → Keyboard → Advanced і ввімкніть консоль розробника. Відкрийте її клавішею ~ під Esc, вставте команду й натисніть Enter. Якщо ~ не працює, перевірте клавішу Toggle console в налаштуваннях клавіатури.",
    command: "Команда консолі",
    favoritesHeading: "3. Збережіть сервер в Обраному",
    favoritesStep:
      "У CS:S відкрийте Find Servers → Favorites → Add a Server. Введіть адресу нижче, додайте сервер, виберіть його й натисніть Connect.",
    help: "Не вдається підключитися? Перевірте адресу, з’єднання, встановлення та оновлення CS:S. Якщо сервер недоступний, спробуйте пізніше. Поділіться повідомленням про помилку в Discord.",
    rules: "Правила сервера",
    languageRule:
      "Правила гри дозволяють мови CZ/SK/EN. Мова сайту не змінює цього правила.",
    chat: "Чат спільноти на англомовній головній сторінці",
    home: "Головна",
  },
  fr: {
    homeTitle: "LaMaTeAm — communauté Counter-Strike: Source",
    homeDescription:
      "LaMaTeAm : serveur communautaire CS:S européen. Adresse du serveur, guide de connexion et Discord.",
    welcome: "Bienvenue chez LaMaTeAm.",
    intro:
      "Un serveur Counter-Strike: Source européen pour la communauté tchèque et slovaque. Des cartes classiques et du fair-play.",
    connectTitle: "Connexion | LaMaTeAm CS:S",
    connectDescription:
      "Rejoignez LaMaTeAm CS:S via Steam, la console du jeu ou les Favoris.",
    join: "Rejoindre LaMaTeAm",
    requirements:
      "Vous avez besoin de Steam et de Counter-Strike: Source installé (pas CS2).",
    privacy:
      "Aucune connexion au site n’est nécessaire pour jouer. La connexion Steam sur le site sert uniquement au chat.",
    steamHeading: "1. Ouvrez Steam et rejoignez le serveur",
    steamStep:
      "Connectez-vous à l’application Steam, puis utilisez le bouton. Autorisez le navigateur à ouvrir Steam si demandé. Si rien ne se passe, lancez CS:S depuis votre bibliothèque et utilisez la console.",
    launch: "Lancer CS:S et se connecter",
    consoleHeading: "2. Ou utilisez la console du jeu",
    consoleStep:
      "Dans CS:S, ouvrez Options → Keyboard → Advanced et activez la console développeur. Ouvrez-la avec la touche ~ sous Échap, collez la commande et appuyez sur Entrée. Si ~ ne fonctionne pas, vérifiez la touche Toggle console dans les paramètres du clavier.",
    command: "Commande de console",
    favoritesHeading: "3. Enregistrez le serveur dans les Favoris",
    favoritesStep:
      "Dans CS:S, ouvrez Find Servers → Favorites → Add a Server. Saisissez l’adresse ci-dessous, ajoutez le serveur, sélectionnez-le et cliquez sur Connect.",
    help: "Impossible de rejoindre le serveur ? Vérifiez l’adresse, votre connexion, l’installation et les mises à jour de CS:S. Si le serveur est indisponible, réessayez plus tard. Partagez le message d’erreur sur Discord.",
    rules: "Règles du serveur",
    languageRule:
      "Les règles du jeu autorisent les langues CZ/SK/EN. La langue du site ne modifie pas cette règle.",
    chat: "Chat communautaire sur la page d’accueil en anglais",
    home: "Accueil",
  },
};

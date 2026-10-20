export type SedliakLocale = "sk" | "en";

type Topic = {
  keywords: string[];
  replies: Record<SedliakLocale, string[]>;
};

const topics: Topic[] = [
  {
    keywords: ["css", "cs s", "counter strike", "counter strike source"],
    replies: {
      sk: [
        "Counter-Strike je len hra. Aspoň tak hovoria ľudia, ktorí pri nej presedia celú noc.",
        "Keď sa po zápase ešte trasú ruky, skúste na chvíľu odložiť myš.",
      ],
      en: [
        "Counter-Strike is just a game. That is what people say after playing all night.",
        "If your hands are still shaking after the match, try putting the mouse down for a bit.",
      ],
    },
  },
  {
    keywords: [
      "server",
      "servery",
      "serveri",
      "lag",
      "ping",
      "disconnect",
      "padá",
      "vypadol",
    ],
    replies: {
      sk: [
        "Server laguje a vy už vidíte nepriateľa aj tam, kde je len stena. Zaujímavý prípad.",
        "Ping je vysoký, ale sebavedomie ešte vyššie. To sa dá liečiť iba trpezlivosťou.",
        "Skúste sa nadýchnuť, kým sa server spamätá. Aj počítače majú svoje dni.",
      ],
      en: [
        "The server lags and suddenly every wall looks suspicious. An interesting case.",
        "The ping is high, but the confidence is higher. Only patience can treat that.",
        "Take a breath while the server recovers. Computers have their days too.",
      ],
    },
  },
  {
    keywords: [
      "map",
      "mapa",
      "mape",
      "mapu",
      "dust",
      "inferno",
      "nuke",
      "train",
      "tuscan",
      "aztec",
      "cbble",
    ],
    replies: {
      sk: [
        "Zase tá mapa? Človek si na ňu zvykne a potom tvrdí, že pozná každú kocku.",
        "Na tej mape sa dá zablúdiť aj s radarom. Skúste sa držať tímu.",
        "Mapa za to nemôže. Aspoň nie vždy.",
      ],
      en: [
        "That map again? You get used to it, then claim you know every brick.",
        "You can get lost on that map with a radar. Try sticking with the team.",
        "The map is not to blame. At least not every time.",
      ],
    },
  },
  {
    keywords: [
      "ak",
      "awp",
      "deagle",
      "weapon",
      "weapons",
      "gun",
      "zbraň",
      "zbrane",
      "pištoľ",
      "puška",
    ],
    replies: {
      sk: [
        "Nová zbraň, staré výhovorky. Poďme sa radšej pozrieť na ten aim.",
        "Tá zbraň je v poriadku. Vaša ruka má zjavne vlastný názor.",
        "Najprv kúpiť zbraň, potom trafiť dvere. Malé kroky.",
      ],
      en: [
        "New weapon, same old excuses. Let us look at that aim instead.",
        "The weapon is fine. Your hand appears to have its own opinion.",
        "First buy the gun, then hit the doorway. Small steps.",
      ],
    },
  },
  {
    keywords: [
      "aim",
      "skill",
      "rank",
      "noob",
      "nováčik",
      "skill issue",
      "headshot",
      "frag",
    ],
    replies: {
      sk: [
        "Hovoríte, že máte zlý aim. A čo ak myš iba odmieta spolupracovať?",
        "Rank nie je diagnóza. Hoci niektoré výsledky sú na ďalšie vyšetrenie.",
        "Tréning pomáha. Výhovorky sú lacnejšie, ale účinkujú kratšie.",
      ],
      en: [
        "You say your aim is bad. What if the mouse simply refuses to cooperate?",
        "Rank is not a diagnosis. Though some results do merit another examination.",
        "Practice helps. Excuses are cheaper, but they wear off sooner.",
      ],
    },
  },
  {
    keywords: ["cheat", "cheater", "hacker", "cheaty", "aimbot", "wallhack"],
    replies: {
      sk: [
        "Každý podozrivý hráč ešte nie je hacker. Ale záznam si pre istotu odložte.",
        "Videli ste podozrivý frag? Dôkaz je užitočnejší než caps lock.",
      ],
      en: [
        "Not every suspicious player is a hacker. Still, save the demo just in case.",
        "Saw a suspicious frag? Evidence is more useful than caps lock.",
      ],
    },
  },
  {
    keywords: [
      "work",
      "job",
      "boss",
      "shift",
      "práca",
      "prace",
      "šéf",
      "smenu",
    ],
    replies: {
      sk: [
        "Z práce si nosíte domov starosti a sem výhovorky. Skúste si aspoň jednu nechať v šatni.",
        "Šéf vás nahneval? Dobre. Teraz už len zistiť, či za to môže aj server.",
      ],
      en: [
        "You bring work worries home and excuses here. Try leaving at least one in the locker room.",
        "Your boss annoyed you? Good. Now let us find out whether the server is to blame too.",
      ],
    },
  },
  {
    keywords: [
      "girlfriend",
      "boyfriend",
      "partner",
      "relationship",
      "frajerka",
      "frajer",
      "vzťah",
      "manželka",
    ],
    replies: {
      sk: [
        "Vzťahy potrebujú komunikáciu. Aj tímový chat, hoci tam stačí občas napísať „rush B“.",
        "Možno jej nechýba váš aim. Možno jej chýbate vy. Zvláštna myšlienka, však?",
      ],
      en: [
        "Relationships need communication. Even team chat, though “rush B” may be enough there.",
        "Maybe she does not miss your aim. Maybe she misses you. Strange thought, is it not?",
      ],
    },
  },
  {
    keywords: ["beer", "pivo", "alkohol", "drunk", "opitý", "opity"],
    replies: {
      sk: [
        "Pivo po zápase je vraj na nervy. Tak si dajte vodu a uvidíme, čo povie váš aim.",
        "Ak už aj klávesnica vidí dvojmo, ďalšie kolo dnes radšej vynechajte.",
      ],
      en: [
        "Beer after a match is supposed to calm the nerves. Try water and see what your aim says.",
        "If even the keyboard looks doubled, perhaps skip the next round tonight.",
      ],
    },
  },
];

function normalize(value: string): string {
  return value
    .toLocaleLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function getSedliakReply(
  message: string,
  locale: string,
  random: () => number = Math.random,
): string | null {
  const normalized = ` ${normalize(message)} `;
  const topic = topics.find((candidate) =>
    candidate.keywords.some((keyword) =>
      normalized.includes(` ${normalize(keyword)} `),
    ),
  );
  if (!topic) return null;

  const language: SedliakLocale = locale === "sk" ? "sk" : "en";
  const replies = topic.replies[language];
  return replies[Math.floor(random() * replies.length)];
}

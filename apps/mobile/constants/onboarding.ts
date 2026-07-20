import {
  Person,
  UsersThree,
  Compass,
  Clock,
  HandTap,
  Bell,
  UserPlus,
  CheckCircle,
  Warning,
  MapPin,
  Timer,
  ShieldCheck,
  type Icon as PhosphorIcon,
} from "phosphor-react-native";
import type { Persona } from "@/stores/onboarding";

// Screen 1: Persona selection cards
export interface PersonaCard {
  id: Persona;
  icon: PhosphorIcon;
  title: string;
  description: string;
}

export const PERSONA_CARDS: PersonaCard[] = [
  {
    id: "alone",
    icon: Person,
    title: "Bydlím sám/sama",
    description: "Chci, aby o mně někdo věděl",
  },
  {
    id: "caregiver",
    icon: UsersThree,
    title: "Starám se o blízkého",
    description: "Chci mít přehled o serverem potvrzených check-inech",
  },
  {
    id: "traveler",
    icon: Compass,
    title: "Cestuji sám/sama",
    description: "Chci pojistku pro případ nouze",
  },
];

// Screen 2: Empathy messages
export const EMPATHY_CONTENT: Record<Persona, string> = {
  alone:
    "Když žijete sami, občas vás napadne: co kdyby se mi něco stalo a nikdo by nevěděl? Ten pocit znáte. A právě proto existujeme.",
  caregiver:
    "Máte svůj život, ale v hlavě pořád myšlenku: ozvala se maminka? Chcete mít přehled o potvrzených check-inech, aniž byste museli neustále volat.",
  traveler:
    "Milujete svobodu cestování, ale vaši blízcí se bojí. Nechcete se omezovat, ale chcete, aby věděli, že jste OK.",
};

// Screen 3: Solution timeline steps
export interface TimelineStep {
  icon: PhosphorIcon;
  title: string;
  description: string;
}

export const SOLUTION_STEPS: Record<Persona, TimelineStep[]> = {
  alone: [
    {
      icon: Clock,
      title: "Nastavíte si jak často se chcete hlásit",
      description: "Jednou denně, dvakrát, jak potřebujete.",
    },
    {
      icon: HandTap,
      title: "Jedním klepnutím řeknete: jsem OK",
      description: "Zabere to dvě sekundy.",
    },
    {
      icon: Bell,
      title: "Když server nezaznamená check-in včas, vytvoří incident",
      description: "Pokusí se upozornit strážce; doručení push nelze garantovat.",
    },
  ],
  caregiver: [
    {
      icon: UserPlus,
      title: "Pozvete svého blízkého do appky",
      description: "Stačí zadat email.",
    },
    {
      icon: CheckCircle,
      title: "Uvidíte serverem potvrzený check-in",
      description: "Potvrzení znamená přijetí serverem, ne zdravotní dohled.",
    },
    {
      icon: Warning,
      title: "Pokud se neozve, vznikne incident",
      description: "Server se pokusí poslat push. Hlásím se není tísňová služba.",
    },
  ],
  traveler: [
    {
      icon: MapPin,
      title: "K check-inu můžete volitelně přidat polohu",
      description:
        "Kdyby bylo potřeba, vaši blízcí uvidí kde jste byli naposledy.",
    },
    {
      icon: Timer,
      title: "Nastavíte interval podle plánu cesty",
      description: "Flexibilní podle potřeby.",
    },
    {
      icon: ShieldCheck,
      title: "Když se neozvete, spustí se alarm",
      description: "Vaši blízcí budou vědět.",
    },
  ],
};

// Screen 4: Notification messages for wow moment
export const NOTIFICATION_MESSAGE: Record<Persona, string> = {
  alone: "Server právě potvrdil check-in vašeho blízkého.",
  caregiver: "Server právě potvrdil check-in profilu Maminka.",
  traveler: "Server právě potvrdil check-in vašeho cestovatele.",
};

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
    description: "Chci jednoduchý pravidelný check-in",
  },
  {
    id: "caregiver",
    icon: UsersThree,
    title: "Starám se o blízkého",
    description: "Chci vidět potvrzené check-iny blízkého",
  },
  {
    id: "traveler",
    icon: Compass,
    title: "Cestuji sám/sama",
    description: "Chci dát blízkým další užitečný signál",
  },
];

// Screen 2: Empathy messages
export const EMPATHY_CONTENT: Record<Persona, string> = {
  alone:
    "Když žijete sami, může být uklidňující mít jednoduchý způsob, jak se pravidelně ozvat. Bez každodenního vysvětlování a bez složitého ovládání.",
  caregiver:
    "Péče o blízkého neznamená, že mu musíte neustále volat. Serverem potvrzený check-in může být další domluvený signál, ne náhrada osobního kontaktu.",
  traveler:
    "Na cestách se podmínky mění a připojení nemusí fungovat. Pravidelný check-in může blízkým přidat kontext, ale nenahrazuje plán cesty ani tísňovou komunikaci.",
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
      title: "Nastavíte si interval",
      description: "Od jedné hodiny do sedmi dní, vždy podle serverového času.",
    },
    {
      icon: HandTap,
      title: "Odešlete check-in",
      description: "Za potvrzený se počítá až po přijetí serverem.",
    },
    {
      icon: Bell,
      title: "Po termínu vznikne incident",
      description: "Server se pokusí upozornit strážce; doručení push nelze garantovat.",
    },
  ],
  caregiver: [
    {
      icon: UserPlus,
      title: "Vlastník profilu vás pozve",
      description: "Pozvání přijmete pod ověřenou e-mailovou adresou.",
    },
    {
      icon: CheckCircle,
      title: "Uvidíte stav profilu",
      description: "Potvrzení znamená přijetí check-inu serverem, ne zdravotní dohled.",
    },
    {
      icon: Warning,
      title: "Po termínu vznikne incident",
      description: "Server se pokusí poslat push. Hlásím se není tísňová služba.",
    },
  ],
  traveler: [
    {
      icon: MapPin,
      title: "Poloha je vždy volitelná",
      description:
        "Připojí se jen ke konkrétnímu check-inu a strážce ji uvidí pouze při otevřeném incidentu.",
    },
    {
      icon: Timer,
      title: "Interval přizpůsobíte cestě",
      description: "Server počítá termín; offline požadavek čeká na skutečné přijetí.",
    },
    {
      icon: ShieldCheck,
      title: "Po termínu vznikne incident",
      description: "Server se pokusí upozornit strážce, ale doručení push nemůže zaručit.",
    },
  ],
};

// Screen 4: Notification messages for wow moment
export const NOTIFICATION_MESSAGE: Record<Persona, string> = {
  alone: "Server potvrdil check-in profilu Domov.",
  caregiver: "Server potvrdil check-in hlídaného profilu.",
  traveler: "Server potvrdil check-in profilu Cesta.",
};

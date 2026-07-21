import { ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BackHeader, Notice } from "@/components/product/ProductUI";

const terms = [
  ["Potvrzený check-in", "Server požadavek přijal, uložil a vrátil nový termín."],
  ["Čekající offline požadavek", "Existuje jen v zařízení. Není důkazem bezpečí a neposunul serverový termín."],
  ["Incident", "Server zjistil prošlý termín aktivního profilu. Neznamená automatické zavolání pomoci."],
  ["Push odeslán poskytovateli", "Poskytovatel přijal ticket. Není to důkaz doručení ani přečtení."],
  ["Poslední známá poloha", "Volitelná poloha potvrzeného check-inu. Není živá a strážce ji vidí jen při aktivním incidentu."],
];
export default function SafetyInfoScreen() {
  return <SafeAreaView className="flex-1 bg-cream"><ScrollView contentContainerClassName="px-5 pb-36"><BackHeader title="Jak služba funguje" /><Text className="font-display text-[38px] leading-[42px] text-charcoal mt-5">Slova, na kterých záleží</Text><View className="mt-8">{terms.map(([title, detail]) => <View key={title} className="py-5 border-b border-sand"><Text className="font-body-semibold text-lg text-charcoal">{title}</Text><Text className="font-body text-base leading-6 text-muted mt-2">{detail}</Text></View>)}</View><View className="mt-8"><Notice title="Není to tísňová služba" tone="danger"><Text className="font-body text-[#9E2E2A] leading-5">Doručení push nelze garantovat. Hlásím se nekontaktuje 112, 155, policii ani fyzickou dohledovou službu.</Text></Notice></View></ScrollView></SafeAreaView>;
}

import { useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  Animated,
  ViewToken,
} from "react-native";
import { router } from "expo-router";
import { useOnboardingStore } from "@/stores/onboarding";

interface Slide {
  id: string;
  emoji: string;
  title: string;
  description: string;
}

const slides: Slide[] = [
  {
    id: "1",
    emoji: "👋",
    title: "Vítejte v Hlásím se",
    description:
      "Aplikace, která pomáhá vašim blízkým vědět, že jste v pořádku. Jednoduchý způsob, jak zůstat v kontaktu.",
  },
  {
    id: "2",
    emoji: "⏰",
    title: "Pravidelné hlášení",
    description:
      "Nastavte si pravidelné připomínky a jedním klepnutím dejte vědět, že je vše v pořádku. Žádné složité zprávy.",
  },
  {
    id: "3",
    emoji: "🛡️",
    title: "Klid pro vaše blízké",
    description:
      "Vaši blízcí budou informováni, pokud se neozvet včas. Bezpečí a klid mysli pro celou rodinu.",
  },
];

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const { completeOnboarding } = useOnboardingStore();

  const viewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setCurrentIndex(viewableItems[0].index);
      }
    }
  ).current;

  const viewConfig = useRef({ viewAreaCoveragePercentThreshold: 50 }).current;

  const handleNext = async () => {
    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      await completeOnboarding();
      router.replace("/(auth)/login");
    }
  };

  const handleSkip = async () => {
    await completeOnboarding();
    router.replace("/(auth)/login");
  };

  const renderSlide = ({ item }: { item: Slide }) => (
    <View
      style={{ width }}
      className="flex-1 items-center justify-center px-8"
    >
      <Text className="text-8xl mb-8">{item.emoji}</Text>
      <Text className="text-3xl font-bold text-charcoal text-center mb-4">
        {item.title}
      </Text>
      <Text className="text-lg text-muted text-center leading-7">
        {item.description}
      </Text>
    </View>
  );

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <View className="flex-1 bg-cream">
      <View className="flex-1">
        <FlatList
          ref={flatListRef}
          data={slides}
          renderItem={renderSlide}
          keyExtractor={(item) => item.id}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onScroll={Animated.event(
            [{ nativeEvent: { contentOffset: { x: scrollX } } }],
            { useNativeDriver: false }
          )}
          onViewableItemsChanged={viewableItemsChanged}
          viewabilityConfig={viewConfig}
          scrollEventThrottle={32}
        />
      </View>

      <View className="px-8 pb-12">
        <View className="flex-row justify-center mb-8">
          {slides.map((_, index) => {
            const inputRange = [
              (index - 1) * width,
              index * width,
              (index + 1) * width,
            ];

            const dotWidth = scrollX.interpolate({
              inputRange,
              outputRange: [8, 24, 8],
              extrapolate: "clamp",
            });

            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.3, 1, 0.3],
              extrapolate: "clamp",
            });

            return (
              <Animated.View
                key={index}
                style={{
                  width: dotWidth,
                  opacity,
                }}
                className="h-2 bg-coral rounded-full mx-1"
              />
            );
          })}
        </View>

        <TouchableOpacity
          className="bg-coral rounded-[2rem] py-4 items-center mb-4"
          onPress={handleNext}
          activeOpacity={0.8}
        >
          <Text className="text-white font-semibold text-lg">
            {isLastSlide ? "Začít" : "Pokračovat"}
          </Text>
        </TouchableOpacity>

        {!isLastSlide && (
          <TouchableOpacity
            className="py-2 items-center"
            onPress={handleSkip}
            activeOpacity={0.6}
          >
            <Text className="text-muted text-base">Přeskočit</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

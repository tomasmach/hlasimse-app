import { useRef, useState } from "react";
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  useWindowDimensions,
  StyleSheet,
} from "react-native";
import { router } from "expo-router";
import Animated, {
  SharedValue,
  useSharedValue,
  useAnimatedStyle,
  interpolate,
} from "react-native-reanimated";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import { useOnboardingStore } from "@/stores/onboarding";
import { Hand, Clock, Shield, type Icon as PhosphorIcon } from "phosphor-react-native";
import { DemoCheckIn } from "@/components/DemoCheckIn";
import { GradientButton } from "@/components/ui";
import { COLORS, GRADIENTS } from "@/constants/design";

function PaginationDot({
  index,
  width,
  scrollX,
}: {
  index: number;
  width: number;
  scrollX: SharedValue<number>;
}) {
  const inputRange = [
    (index - 1) * width,
    index * width,
    (index + 1) * width,
  ];

  const dotStyle = useAnimatedStyle(() => {
    const dotWidth = interpolate(
      scrollX.value,
      inputRange,
      [8, 24, 8],
      "clamp"
    );
    const opacity = interpolate(
      scrollX.value,
      inputRange,
      [0.3, 1, 0.3],
      "clamp"
    );

    return { width: dotWidth, opacity };
  });

  return (
    <Animated.View style={[styles.dot, dotStyle]}>
      <LinearGradient
        colors={GRADIENTS.coral}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        className="flex-1"
      />
    </Animated.View>
  );
}

interface Slide {
  id: string;
  icon: PhosphorIcon;
  title: string;
  description: string;
}

const slides: Slide[] = [
  {
    id: "1",
    icon: Hand,
    title: "Vítejte v Hlásím se",
    description:
      "Aplikace, která pomáhá vašim blízkým vědět, že jste v pořádku.",
  },
  {
    id: "2",
    icon: Clock,
    title: "Pravidelné hlášení",
    description:
      "Jedním klepnutím dejte vědět, že je vše v pořádku. Žádné složité zprávy.",
  },
  {
    id: "3",
    icon: Shield,
    title: "Klid pro vaše blízké",
    description:
      "Vaši blízcí budou informováni, pokud se neozvete včas.",
  },
];

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(0);
  const [showDemo, setShowDemo] = useState(false);
  const flatListRef = useRef<FlatList<Slide>>(null);
  const scrollX = useSharedValue(0);
  const { completeOnboarding } = useOnboardingStore();

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    if (currentIndex < slides.length - 1) {
      flatListRef.current?.scrollToIndex({ index: currentIndex + 1 });
    } else {
      // Show demo instead of going to login
      setShowDemo(true);
    }
  };

  const handleSkip = async () => {
    await completeOnboarding();
    router.replace("/(auth)/login");
  };

  const handleDemoComplete = async () => {
    await completeOnboarding();
    router.replace("/(auth)/register");
  };

  const handleDemoSkip = async () => {
    await completeOnboarding();
    router.replace("/(auth)/login");
  };

  if (showDemo) {
    return (
      <DemoCheckIn
        onComplete={handleDemoComplete}
        onSkip={handleDemoSkip}
      />
    );
  }

  const renderSlide = ({ item }: { item: Slide; index: number }) => {
    const Icon = item.icon;
    return (
      <View className="flex-1 items-center justify-center px-10" style={{ width }}>
        <View className="mb-8 items-center justify-center">
          <Icon size={100} color={COLORS.coral.default} weight="regular" />
        </View>
        <Text className="text-[32px] font-extrabold text-charcoal text-center mb-4">
          {item.title}
        </Text>
        <Text className="text-lg text-muted text-center leading-[26px]">
          {item.description}
        </Text>
      </View>
    );
  };

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <View className="flex-1 bg-cream">
      <FlatList
        ref={flatListRef}
        data={slides}
        renderItem={renderSlide}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        bounces={false}
        style={{ flex: 1 }}
        onScroll={(e) => {
          scrollX.value = e.nativeEvent.contentOffset.x;
        }}
        onMomentumScrollEnd={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(newIndex);
        }}
        onScrollEndDrag={(e) => {
          const newIndex = Math.round(e.nativeEvent.contentOffset.x / width);
          setCurrentIndex(newIndex);
        }}
        scrollEventThrottle={16}
      />

      <View className="px-8 pb-12">
        {/* Pagination dots */}
        <View className="flex-row justify-center items-center mb-8 gap-2">
          {slides.map((_, index) => (
            <PaginationDot
              key={index}
              index={index}
              width={width}
              scrollX={scrollX}
            />
          ))}
        </View>

        {/* CTA Buttons */}
        <View className="gap-4">
          <GradientButton
            label={isLastSlide ? "Vyzkoušet" : "Pokračovat"}
            onPress={handleNext}
          />

          <TouchableOpacity
            className="py-3 items-center"
            onPress={handleSkip}
          >
            <Text className="text-base text-muted">Přeskočit</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// Keep only animated dot styles that use interpolate
const styles = StyleSheet.create({
  dot: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
});

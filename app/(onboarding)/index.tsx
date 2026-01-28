// app/(onboarding)/index.tsx
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
        style={styles.dotGradient}
      />
    </Animated.View>
  );
}

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
      "Aplikace, která pomáhá vašim blízkým vědět, že jste v pořádku.",
  },
  {
    id: "2",
    emoji: "⏰",
    title: "Pravidelné hlášení",
    description:
      "Jedním klepnutím dejte vědět, že je vše v pořádku. Žádné složité zprávy.",
  },
  {
    id: "3",
    emoji: "🛡️",
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

  const renderSlide = ({ item, index }: { item: Slide; index: number }) => (
    <View style={[styles.slide, { width }]}>
      <Text style={styles.emoji}>{item.emoji}</Text>
      <Text style={styles.slideTitle}>{item.title}</Text>
      <Text style={styles.slideDescription}>{item.description}</Text>
    </View>
  );

  const isLastSlide = currentIndex === slides.length - 1;

  return (
    <View style={styles.container}>
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

      <View style={styles.footer}>
        {/* Pagination dots */}
        <View style={styles.pagination}>
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
        <View style={styles.buttons}>
          <GradientButton
            label={isLastSlide ? "Vyzkoušet" : "Pokračovat"}
            onPress={handleNext}
          />

          {!isLastSlide && (
            <TouchableOpacity
              style={styles.skipButton}
              onPress={handleSkip}
            >
              <Text style={styles.skipText}>Přeskočit</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.cream.default,
  },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 40,
  },
  emoji: {
    fontSize: 100,
    marginBottom: 32,
  },
  slideTitle: {
    fontSize: 32,
    fontWeight: "800",
    color: COLORS.charcoal.default,
    textAlign: "center",
    marginBottom: 16,
  },
  slideDescription: {
    fontSize: 18,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 26,
  },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 48,
  },
  pagination: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 32,
    gap: 8,
  },
  dot: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
  },
  dotGradient: {
    flex: 1,
  },
  buttons: {
    gap: 16,
  },
  skipButton: {
    paddingVertical: 12,
    alignItems: "center",
  },
  skipText: {
    fontSize: 16,
    color: COLORS.muted,
  },
});

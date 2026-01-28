import React from "react";
import { View, Pressable, Text, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
} from "react-native-reanimated";
import { House, UsersThree, GearSix, IconProps } from "phosphor-react-native";
import { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { COLORS, ANIMATION, SHADOWS } from "@/constants/design";

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type TabConfig = {
  name: string;
  icon: React.ComponentType<IconProps>;
  label: string;
};

const TABS: TabConfig[] = [
  { name: "index", icon: House, label: "Domů" },
  { name: "guardians", icon: UsersThree, label: "Strážci" },
  { name: "settings", icon: GearSix, label: "Nastavení" },
];

type TabButtonProps = {
  tab: TabConfig;
  isActive: boolean;
  onPress: () => void;
};

function TabButton({ tab, isActive, onPress }: TabButtonProps) {
  const scale = useSharedValue(1);
  const Icon = tab.icon;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.9, ANIMATION.spring.bouncy);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1, ANIMATION.spring.bouncy);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <AnimatedPressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={[styles.tabButton, animatedStyle]}
    >
      <View style={[styles.iconContainer, isActive && styles.iconContainerActive]}>
        <Icon
          size={24}
          weight={isActive ? "fill" : "light"}
          color={isActive ? COLORS.coral.default : COLORS.muted}
        />
      </View>
      <Text style={[styles.label, isActive && styles.labelActive]}>
        {tab.label}
      </Text>
    </AnimatedPressable>
  );
}

export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const visibleRoutes = state.routes.filter((route) =>
    TABS.some((tab) => tab.name === route.name)
  );

  return (
    <View style={styles.container}>
      <View style={styles.blurContainer}>
        <BlurView intensity={80} tint="light" style={styles.blur}>
          <View style={styles.tabBar}>
            {visibleRoutes.map((route) => {
              const tab = TABS.find((t) => t.name === route.name);
              if (!tab) return null;

              const routeIndex = state.routes.findIndex((r) => r.name === route.name);
              const isActive = state.index === routeIndex;

              const handlePress = () => {
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });

                if (!isActive && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              return (
                <TabButton
                  key={route.key}
                  tab={tab}
                  isActive={isActive}
                  onPress={handlePress}
                />
              );
            })}
          </View>
        </BlurView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: Platform.OS === "ios" ? 34 : 16,
    left: 24,
    right: 24,
  },
  blurContainer: {
    borderRadius: 24,
    borderWidth: 1,
    borderColor: `${COLORS.coral.light}30`,
    ...SHADOWS.floating,
  },
  blur: {
    backgroundColor: "rgba(255, 255, 255, 0.8)",
  },
  tabBar: {
    flexDirection: "row",
    paddingVertical: 12,
    paddingHorizontal: 32,
    justifyContent: "space-around",
    alignItems: "center",
  },
  tabButton: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  iconContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  iconContainerActive: {
    backgroundColor: `${COLORS.coral.default}15`,
  },
  label: {
    fontSize: 11,
    fontWeight: "500",
    color: COLORS.muted,
    marginTop: 4,
  },
  labelActive: {
    color: COLORS.coral.default,
    fontWeight: "600",
  },
});

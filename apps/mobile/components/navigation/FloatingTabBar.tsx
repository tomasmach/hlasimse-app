import { View, Pressable, Text, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import * as Haptics from "expo-haptics";
import { House, UsersThree, ClockCounterClockwise, GearSix, IconProps } from "phosphor-react-native";
import type { BottomTabBarProps } from "expo-router/js-tabs";
import { COLORS, SHADOWS } from "@/constants/design";

type TabConfig = {
  name: string;
  icon: React.ComponentType<IconProps>;
  label: string;
};

const TABS: TabConfig[] = [
  { name: "index", icon: House, label: "Domů" },
  { name: "guardians", icon: UsersThree, label: "Strážci" },
  { name: "activity", icon: ClockCounterClockwise, label: "Historie" },
  { name: "settings", icon: GearSix, label: "Nastavení" },
];

type TabButtonProps = {
  tab: TabConfig;
  isActive: boolean;
  onPress: () => void;
};

function TabButton({ tab, isActive, onPress }: TabButtonProps) {
  const Icon = tab.icon;

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      className="items-center justify-center flex-1"
      accessibilityRole="tab"
      accessibilityLabel={tab.label}
      accessibilityState={{ selected: isActive }}
      testID={`tab-${tab.name}`}
    >
      <View className={`w-10 h-10 rounded-[20px] items-center justify-center ${isActive ? 'bg-coral/15' : ''}`}>
        <Icon
          size={24}
          weight={isActive ? "fill" : "light"}
          color={isActive ? COLORS.charcoal.default : COLORS.muted}
        />
      </View>
      <Text className={`text-[12px] font-body-medium mt-1 ${isActive ? 'text-charcoal font-body-semibold' : 'text-muted'}`}>
        {tab.label}
      </Text>
    </Pressable>
  );
}

export function FloatingTabBar({ state, navigation }: BottomTabBarProps) {
  const visibleRoutes = state.routes.filter((route) =>
    TABS.some((tab) => tab.name === route.name)
  );

  return (
    <View style={styles.container}>
      <View style={styles.blurContainer}>
        <BlurView intensity={80} tint="light" className="bg-white/80">
          <View className="flex-row py-2 px-3 justify-around items-center">
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

// Keep only styles that must remain (position, shadows, dynamic border color)
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
});

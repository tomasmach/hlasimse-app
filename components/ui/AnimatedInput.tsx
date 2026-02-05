import { useState, forwardRef } from "react";
import {
  View,
  TextInput,
  TextInputProps,
  Pressable,
  Text,
  StyleSheet,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolateColor,
} from "react-native-reanimated";
import { Eye, EyeSlash } from "phosphor-react-native";
import { COLORS, ANIMATION } from "@/constants/design";

interface AnimatedInputProps extends TextInputProps {
  label: string;
  error?: string;
}

const AnimatedText = Animated.createAnimatedComponent(Text);

export const AnimatedInput = forwardRef<TextInput, AnimatedInputProps>(
  ({ label, error, value, onChangeText, secureTextEntry, style, ...props }, ref) => {
    const [isFocused, setIsFocused] = useState(false);
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);

    // Animation values
    const focusProgress = useSharedValue(0);
    const hasValue = value && value.length > 0;

    // Label animation - KEEP in StyleSheet (uses interpolation)
    const labelStyle = useAnimatedStyle(() => {
      const isActive = focusProgress.value > 0 || hasValue;
      return {
        transform: [
          {
            translateY: withTiming(isActive ? -24 : 0, {
              duration: ANIMATION.timing.normal,
            }),
          },
          {
            scale: withTiming(isActive ? 0.85 : 1, {
              duration: ANIMATION.timing.normal,
            }),
          },
        ],
        color: withTiming(
          isActive
            ? error
              ? COLORS.error
              : COLORS.coral.default
            : COLORS.muted,
          { duration: ANIMATION.timing.normal }
        ),
      };
    });

    // Border animation - KEEP in StyleSheet (uses interpolateColor)
    const borderStyle = useAnimatedStyle(() => {
      return {
        backgroundColor: interpolateColor(
          focusProgress.value,
          [0, 1],
          [error ? COLORS.error : COLORS.sand, error ? COLORS.error : COLORS.coral.default]
        ),
        height: withTiming(focusProgress.value > 0 ? 2 : 1, {
          duration: ANIMATION.timing.normal,
        }),
      };
    });

    const handleFocus = () => {
      setIsFocused(true);
      focusProgress.value = withTiming(1, { duration: ANIMATION.timing.normal });
    };

    const handleBlur = () => {
      setIsFocused(false);
      focusProgress.value = withTiming(0, { duration: ANIMATION.timing.normal });
    };

    const togglePasswordVisibility = () => {
      setIsPasswordVisible(!isPasswordVisible);
    };

    return (
      <View className="mb-4">
        <View className="relative pt-4">
          {/* Floating label */}
          <AnimatedText
            style={[styles.label, labelStyle]}
            pointerEvents="none"
          >
            {label}
          </AnimatedText>

          {/* Text input */}
          <TextInput
            ref={ref}
            value={value}
            onChangeText={onChangeText}
            onFocus={handleFocus}
            onBlur={handleBlur}
            secureTextEntry={secureTextEntry && !isPasswordVisible}
            className="text-base text-charcoal py-2 pr-10"
            style={style}
            placeholderTextColor={COLORS.muted}
            {...props}
          />

          {/* Password toggle */}
          {secureTextEntry && (
            <Pressable
              onPress={togglePasswordVisibility}
              className="absolute right-0 top-5 p-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              {isPasswordVisible ? (
                <EyeSlash size={20} color={COLORS.muted} weight="regular" />
              ) : (
                <Eye size={20} color={COLORS.muted} weight="regular" />
              )}
            </Pressable>
          )}

          {/* Animated bottom border */}
          <Animated.View style={[styles.border, borderStyle]} />
        </View>

        {/* Error message */}
        {error && <Text className="text-error text-xs mt-1">{error}</Text>}
      </View>
    );
  }
);

AnimatedInput.displayName = "AnimatedInput";

// Keep only animated styles that need interpolation
const styles = StyleSheet.create({
  label: {
    position: "absolute",
    left: 0,
    top: 24,
    fontSize: 16,
    fontWeight: "400",
    transformOrigin: "left top",
  },
  border: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
  },
});

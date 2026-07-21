import { forwardRef, useId, useState } from "react";
import {
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { Eye, EyeSlash } from "phosphor-react-native";
import { COLORS } from "@/constants/design";

type AuthInputProps = TextInputProps & {
  label: string;
  error?: string;
  testID: string;
};

export const AuthInput = forwardRef<TextInput, AuthInputProps>(
  ({ label, error, secureTextEntry, testID, editable = true, ...props }, ref) => {
    const fallbackId = useId().replace(/:/g, "");
    const [focused, setFocused] = useState(false);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const errorId = `${testID || fallbackId}-error`;

    return (
      <View className="mb-5">
        <Text
          nativeID={`${testID || fallbackId}-label`}
          className="mb-2 font-body-semibold text-[15px] text-charcoal"
        >
          {label}
        </Text>
        <View
          className={`min-h-[58px] flex-row items-center rounded-[18px] border bg-white px-4 ${
            error ? "border-[#C33D2F]" : focused ? "border-charcoal" : "border-sand"
          }`}
        >
          <TextInput
            {...props}
            ref={ref}
            testID={testID}
            editable={editable}
            secureTextEntry={secureTextEntry && !passwordVisible}
            onFocus={(event) => {
              setFocused(true);
              props.onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              props.onBlur?.(event);
            }}
            className="min-h-[56px] flex-1 py-3 font-body text-[17px] text-charcoal"
            placeholderTextColor={COLORS.muted}
            accessibilityLabel={props.accessibilityLabel || label}
            accessibilityState={{ disabled: !editable }}
            aria-describedby={error ? errorId : undefined}
          />
          {secureTextEntry ? (
            <Pressable
              testID={`${testID}-visibility-toggle`}
              onPress={() => setPasswordVisible((current) => !current)}
              disabled={!editable}
              className="ml-2 min-h-[48px] min-w-[48px] items-center justify-center"
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={passwordVisible ? "Skrýt heslo" : "Zobrazit heslo"}
              accessibilityState={{ disabled: !editable }}
            >
              {passwordVisible ? (
                <EyeSlash size={22} color={COLORS.charcoal.default} weight="regular" />
              ) : (
                <Eye size={22} color={COLORS.charcoal.default} weight="regular" />
              )}
            </Pressable>
          ) : null}
        </View>
        {error ? (
          <Text
            nativeID={errorId}
            testID={errorId}
            accessibilityRole="alert"
            className="mt-2 font-body text-sm leading-5 text-[#9E382E]"
          >
            {error}
          </Text>
        ) : null}
      </View>
    );
  },
);

AuthInput.displayName = "AuthInput";

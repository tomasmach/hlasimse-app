import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View, type PressableProps } from "react-native";
import { ArrowLeft, CheckCircle, Info, WarningCircle, XCircle, type IconProps } from "phosphor-react-native";
import { router } from "expo-router";
import { COLORS } from "@/constants/design";
import { ACTION_PALETTE } from "@/constants/productDesign";

export function PageTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <View className="flex-row items-start justify-between gap-4 mb-7">
      <View className="flex-1">
        <Text className="font-display text-[34px] leading-[38px] tracking-[-1px] text-charcoal" accessibilityRole="header">{title}</Text>
        {subtitle ? <Text className="font-body text-[16px] leading-6 text-muted mt-2">{subtitle}</Text> : null}
      </View>
      {action}
    </View>
  );
}

export function BackHeader({ title }: { title: string }) {
  return (
    <View className="flex-row items-center gap-3 py-2 mb-5">
      <Pressable
        testID="back-button"
        onPress={() => router.back()}
        className="w-12 h-12 rounded-full bg-white items-center justify-center border border-sand"
        accessibilityRole="button"
        accessibilityLabel="Zpět"
        hitSlop={8}
      >
        <ArrowLeft size={22} color={COLORS.charcoal.default} />
      </Pressable>
      <Text className="font-body-semibold text-xl text-charcoal flex-1" accessibilityRole="header">{title}</Text>
    </View>
  );
}

type NoticeTone = "info" | "warning" | "danger" | "success";
const noticeStyles: Record<NoticeTone, { bg: string; fg: string; Icon: React.ComponentType<IconProps> }> = {
  info: { bg: "#E8F0F0", fg: "#315C5D", Icon: Info },
  warning: { bg: "#FFF0D7", fg: "#7B4A08", Icon: WarningCircle },
  danger: { bg: "#FFE7E3", fg: "#9E2E2A", Icon: XCircle },
  success: { bg: "#E5F3EA", fg: "#245E3C", Icon: CheckCircle },
};

export function Notice({ title, children, tone = "info" }: { title: string; children?: ReactNode; tone?: NoticeTone }) {
  const style = noticeStyles[tone];
  return (
    <View
      style={{ backgroundColor: style.bg }}
      className="rounded-[22px] p-4 flex-row gap-3"
      accessibilityRole="alert"
    >
      <style.Icon size={23} weight="fill" color={style.fg} />
      <View className="flex-1">
        <Text style={{ color: style.fg }} className="font-body-semibold text-[15px] leading-5">{title}</Text>
        {children ? <View className="mt-1">{children}</View> : null}
      </View>
    </View>
  );
}

export function StatusLabel({ label, tone = "info" }: { label: string; tone?: NoticeTone }) {
  const style = noticeStyles[tone];
  return (
    <View style={{ backgroundColor: style.bg }} className="self-start rounded-full px-3 py-2 flex-row items-center gap-2">
      <style.Icon size={16} weight="fill" color={style.fg} />
      <Text style={{ color: style.fg }} className="font-body-semibold text-[13px]">{label}</Text>
    </View>
  );
}

interface ActionButtonProps extends PressableProps {
  label: string;
  variant?: "primary" | "dark" | "quiet" | "danger";
  loading?: boolean;
  icon?: ReactNode;
}

export function ActionButton({ label, variant = "primary", loading, icon, disabled, ...props }: ActionButtonProps) {
  const palette = ACTION_PALETTE[variant];
  return (
    <Pressable
      {...props}
      disabled={disabled || loading}
      style={({ pressed }) => ({ backgroundColor: palette.bg, opacity: disabled ? 0.45 : pressed ? 0.78 : 1, minHeight: 52 })}
      className="rounded-[18px] px-5 py-3 flex-row items-center justify-center gap-2"
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel || label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(loading) }}
    >
      {loading ? <ActivityIndicator color={palette.fg} /> : icon}
      {!loading ? <Text style={{ color: palette.fg }} className="font-body-semibold text-[16px] text-center">{label}</Text> : null}
    </Pressable>
  );
}

export function Metric({ value, label }: { value: string | number; label: string }) {
  return (
    <View className="flex-1 min-w-[95px] py-3">
      <Text className="font-display text-[30px] leading-9 text-charcoal" adjustsFontSizeToFit minimumFontScale={0.75}>{value}</Text>
      <Text className="font-body text-[13px] leading-[18px] text-muted mt-1">{label}</Text>
    </View>
  );
}

export function Divider() {
  return <View className="h-px bg-sand" />;
}

import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Archive, CaretDown, Check, ClockCounterClockwise } from "phosphor-react-native";

import { COLORS } from "@/constants/design";
import type { CheckInProfile } from "@/types/database";
import type { ArchivedProfileSummary } from "@/types/product";

interface ProfileTimelinePickerProps {
  activeProfiles: CheckInProfile[];
  archivedProfiles: ArchivedProfileSummary[];
  selectedId: string | null;
  archivedNext: string | null;
  archivedLoading: boolean;
  onSelect: (profileId: string) => void;
  onLoadMoreArchived: () => void;
}

const formatArchivedAt = (value: string) =>
  new Intl.DateTimeFormat("cs-CZ", { dateStyle: "medium" }).format(new Date(value));

export function ProfileTimelinePicker({
  activeProfiles,
  archivedProfiles,
  selectedId,
  archivedNext,
  archivedLoading,
  onSelect,
  onLoadMoreArchived,
}: ProfileTimelinePickerProps) {
  const [expanded, setExpanded] = useState(false);
  const selectedActive = activeProfiles.find((item) => item.id === selectedId);
  const selectedArchived = archivedProfiles.find((item) => item.id === selectedId);
  const selectedName = selectedActive?.name ?? selectedArchived?.name ?? "Vybrat profil";
  const hasProfiles = activeProfiles.length > 0 || archivedProfiles.length > 0;

  const choose = (profileId: string) => {
    onSelect(profileId);
    setExpanded(false);
  };

  return (
    <View className="mb-7 border-y border-sand">
      <Pressable
        testID="timeline-profile-picker"
        onPress={() => setExpanded((value) => !value)}
        disabled={!hasProfiles}
        className="min-h-[64px] py-3 flex-row items-center gap-4"
        accessibilityRole="button"
        accessibilityState={{ expanded, disabled: !hasProfiles, busy: archivedLoading }}
        accessibilityLabel={`Historie profilu: ${selectedName}`}
      >
        {selectedArchived ? (
          <Archive size={23} color={COLORS.muted} />
        ) : (
          <ClockCounterClockwise size={23} color={COLORS.brand[500]} />
        )}
        <View className="flex-1">
          <Text className="font-body text-xs text-muted">Historie profilu</Text>
          <Text className="font-body-semibold text-base text-charcoal mt-1">{selectedName}</Text>
        </View>
        <CaretDown
          size={20}
          color={COLORS.muted}
          style={{ transform: [{ rotate: expanded ? "180deg" : "0deg" }] }}
        />
      </Pressable>

      {expanded ? (
        <View className="pb-3 border-t border-sand" accessibilityRole="radiogroup">
          {activeProfiles.length ? (
            <>
              <Text className="font-body-semibold text-xs text-muted uppercase tracking-wider pt-4 pb-1">
                Aktivní profily
              </Text>
              {activeProfiles.map((item) => (
                <Pressable
                  key={item.id}
                  testID={`timeline-profile-active-${item.id}`}
                  onPress={() => choose(item.id)}
                  className="min-h-[56px] py-3 flex-row items-center gap-3 border-b border-sand"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selectedId === item.id }}
                >
                  <Text className="font-body text-base text-charcoal flex-1">{item.name}</Text>
                  {selectedId === item.id ? <Check size={20} color={COLORS.brand[500]} /> : null}
                </Pressable>
              ))}
            </>
          ) : null}

          {archivedProfiles.length ? (
            <>
              <Text className="font-body-semibold text-xs text-muted uppercase tracking-wider pt-5 pb-1">
                Archivované profily
              </Text>
              {archivedProfiles.map((item) => (
                <Pressable
                  key={item.id}
                  testID={`timeline-profile-archived-${item.id}`}
                  onPress={() => choose(item.id)}
                  className="min-h-[64px] py-3 flex-row items-center gap-3 border-b border-sand"
                  accessibilityRole="radio"
                  accessibilityState={{ checked: selectedId === item.id }}
                >
                  <Archive size={20} color={COLORS.muted} />
                  <View className="flex-1">
                    <Text className="font-body text-base text-charcoal">{item.name}</Text>
                    <Text className="font-body text-xs text-muted mt-1">
                      Archivováno {formatArchivedAt(item.archived_at)}
                    </Text>
                  </View>
                  {selectedId === item.id ? <Check size={20} color={COLORS.brand[500]} /> : null}
                </Pressable>
              ))}
            </>
          ) : null}

          {archivedNext ? (
            <Pressable
              testID="timeline-archived-load-more"
              onPress={onLoadMoreArchived}
              disabled={archivedLoading}
              className="min-h-[56px] justify-center"
              accessibilityRole="button"
              accessibilityState={{ disabled: archivedLoading, busy: archivedLoading }}
            >
              <Text className="font-body-semibold text-brand-500">
                {archivedLoading ? "Načítáme další archiv…" : "Načíst další archivované profily"}
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

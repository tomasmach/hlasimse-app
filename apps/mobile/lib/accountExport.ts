import { Platform } from "react-native";
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import type { AccountExport } from "@/types/product";

export async function deliverAccountExport(data: AccountExport): Promise<void> {
  const contents = JSON.stringify(data, null, 2);
  const filename = `hlasim-se-export-${new Date().toISOString().slice(0, 10)}.json`;
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([contents], { type: "application/json" }));
    try {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
    } finally {
      URL.revokeObjectURL(url);
    }
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Systémová nabídka sdílení není na tomto zařízení dostupná.");
  const file = new File(Paths.cache, filename);
  try {
    file.create({ overwrite: true });
    file.write(contents);
    await Sharing.shareAsync(file.uri, {
      dialogTitle: "Uložit export dat Hlásím se",
      mimeType: "application/json",
      UTI: "public.json",
    });
  } finally {
    if (file.exists) file.delete();
  }
}

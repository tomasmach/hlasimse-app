import type { AlertDeliveryState, DeliveryAttemptStatus } from "@/types/product";

export interface DeliveryStatePresentation {
  label: string;
  detail: string;
  tone: "info" | "warning" | "danger" | "success";
}

export const deliveryStatePresentation: Record<
  AlertDeliveryState,
  DeliveryStatePresentation
> = {
  no_delivery_record: {
    label: "Bez záznamu o odeslání",
    detail: "Server zatím neeviduje pokus o push.",
    tone: "warning",
  },
  pending: {
    label: "Čeká na pokus o odeslání",
    detail: "Push je ve frontě nebo se bude opakovat.",
    tone: "warning",
  },
  sent_to_provider: {
    label: "Odesláno poskytovateli",
    detail:
      "Poskytovatel přijal požadavek nebo ticket. Doručení ani přečtení tím není potvrzeno.",
    tone: "info",
  },
  accepted_by_push_service: {
    label: "Přijato službou APNs/FCM",
    detail:
      "Push služba požadavek převzala. Zobrazení na zařízení ani přečtení tím není potvrzeno.",
    tone: "info",
  },
  failed: {
    label: "Pokus o doručení selhal",
    detail:
      "Nespoléhejte na push. Použijte jiný kontakt a podle situace tísňovou linku.",
    tone: "danger",
  },
};

export const deliveryAttemptLabel: Record<DeliveryAttemptStatus, string> = {
  queued: "Čeká ve frontě",
  ticket_received: "Poskytovatel přijal požadavek",
  receipt_processing: "Čeká na potvrzení push služby",
  provider_accepted: "Push služba přijala požadavek",
  retryable_failure: "Dočasná chyba, server pokus zopakuje",
  permanent_failure: "Trvalá chyba odeslání",
  dead_letter: "Automatické pokusy byly vyčerpány",
};

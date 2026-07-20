export type CheckInAttemptResult = {
  success: boolean;
  offline: boolean;
};

export type CheckInFeedback = {
  showServerConfirmation: boolean;
  toast: {
    type: "warning" | "error";
    message: string;
  } | null;
};

export const PENDING_CHECK_IN_MESSAGE =
  "Čeká na připojení — strážci zatím spoléhají na původní termín.";

export const FAILED_CHECK_IN_MESSAGE =
  "Hlášení se nepodařilo odeslat ani bezpečně uložit. Zkuste to znovu.";

export function getCheckInFeedback(
  result: CheckInAttemptResult
): CheckInFeedback {
  if (result.success && !result.offline) {
    return { showServerConfirmation: true, toast: null };
  }

  if (result.success && result.offline) {
    return {
      showServerConfirmation: false,
      toast: { type: "warning", message: PENDING_CHECK_IN_MESSAGE },
    };
  }

  return {
    showServerConfirmation: false,
    toast: { type: "error", message: FAILED_CHECK_IN_MESSAGE },
  };
}

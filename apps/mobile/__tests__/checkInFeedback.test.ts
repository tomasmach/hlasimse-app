import {
  FAILED_CHECK_IN_MESSAGE,
  PENDING_CHECK_IN_MESSAGE,
  getCheckInFeedback,
} from "../lib/checkInFeedback";

describe("getCheckInFeedback", () => {
  it("shows server confirmation only after an online success", () => {
    expect(getCheckInFeedback({ success: true, offline: false })).toEqual({
      showServerConfirmation: true,
      toast: null,
    });
  });

  it("presents an offline check-in as pending and warns about guardians", () => {
    const feedback = getCheckInFeedback({ success: true, offline: true });

    expect(feedback.showServerConfirmation).toBe(false);
    expect(feedback.toast).toEqual({
      type: "warning",
      message: PENDING_CHECK_IN_MESSAGE,
    });
    expect(PENDING_CHECK_IN_MESSAGE).toContain("zatím nebylo odesláno");
    expect(PENDING_CHECK_IN_MESSAGE).toContain("strážci upozorněni");
  });

  it("does not imply that a failed attempt was queued", () => {
    const feedback = getCheckInFeedback({ success: false, offline: false });

    expect(feedback).toEqual({
      showServerConfirmation: false,
      toast: { type: "error", message: FAILED_CHECK_IN_MESSAGE },
    });
    expect(FAILED_CHECK_IN_MESSAGE).toContain("ani bezpečně uložit");
  });
});

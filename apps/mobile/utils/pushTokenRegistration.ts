export interface ShouldRegisterTokenParams {
  currentUserId: string | null;
  previousUserId: string | null;
  expoPushToken: string | null;
  previousToken: string | null;
}

export function shouldRegisterToken(params: ShouldRegisterTokenParams): boolean {
  const { currentUserId, previousUserId, expoPushToken, previousToken } = params;

  if (!currentUserId || !expoPushToken) {
    return false;
  }

  return currentUserId !== previousUserId || expoPushToken !== previousToken;
}

export interface TokenRegistrationTracker {
  update(params: { userId: string | null; expoPushToken: string | null }): Promise<boolean>;
}

export function createTokenRegistrationTracker(
  registerToken: (userId: string) => void | Promise<void>
): TokenRegistrationTracker {
  let lastRegisteredUserId: string | null = null;
  let lastRegisteredToken: string | null = null;
  let inFlightKey: string | null = null;
  let inFlight: Promise<boolean> | null = null;

  return {
    async update({ userId, expoPushToken }) {
      if (!userId) {
        lastRegisteredUserId = null;
        lastRegisteredToken = null;
        inFlightKey = null;
        inFlight = null;
        return false;
      }
      if (!expoPushToken) return false;
      if (!shouldRegisterToken({
        currentUserId: userId,
        previousUserId: lastRegisteredUserId,
        expoPushToken,
        previousToken: lastRegisteredToken,
      })) return true;

      const key = `${userId}\u0000${expoPushToken}`;
      if (inFlightKey === key && inFlight) return inFlight;
      inFlightKey = key;
      inFlight = Promise.resolve(registerToken(userId)).then(() => {
        lastRegisteredUserId = userId;
        lastRegisteredToken = expoPushToken;
        return true;
      }).finally(() => {
        if (inFlightKey === key) {
          inFlightKey = null;
          inFlight = null;
        }
      });
      return inFlight;
    },
  };
}

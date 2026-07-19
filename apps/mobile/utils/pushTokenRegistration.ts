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
  update(params: { userId: string | null; expoPushToken: string | null }): void;
}

export function createTokenRegistrationTracker(
  registerToken: (userId: string) => void
): TokenRegistrationTracker {
  let lastRegisteredUserId: string | null = null;
  let lastRegisteredToken: string | null = null;

  return {
    update({ userId, expoPushToken }) {
      if (shouldRegisterToken({
        currentUserId: userId,
        previousUserId: lastRegisteredUserId,
        expoPushToken,
        previousToken: lastRegisteredToken,
      })) {
        registerToken(userId!);
        lastRegisteredUserId = userId;
        lastRegisteredToken = expoPushToken;
      }

      // Reset tracker when user logs out
      if (!userId) {
        lastRegisteredUserId = null;
        lastRegisteredToken = null;
      }
    },
  };
}

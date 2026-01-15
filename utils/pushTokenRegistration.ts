export interface ShouldRegisterTokenParams {
  currentUserId: string | null;
  previousUserId: string | null;
  expoPushToken: string | null;
}

export function shouldRegisterToken(params: ShouldRegisterTokenParams): boolean {
  const { currentUserId, previousUserId, expoPushToken } = params;

  if (!currentUserId || !expoPushToken) {
    return false;
  }

  return currentUserId !== previousUserId;
}

export interface TokenRegistrationTracker {
  update(params: { userId: string | null; expoPushToken: string | null }): void;
}

export function createTokenRegistrationTracker(
  registerToken: (userId: string) => void
): TokenRegistrationTracker {
  let lastRegisteredUserId: string | null = null;

  return {
    update({ userId, expoPushToken }) {
      if (shouldRegisterToken({
        currentUserId: userId,
        previousUserId: lastRegisteredUserId,
        expoPushToken,
      })) {
        registerToken(userId!);
        lastRegisteredUserId = userId;
      }

      // Reset tracker when user logs out
      if (!userId) {
        lastRegisteredUserId = null;
      }
    },
  };
}

import { shouldRegisterToken, createTokenRegistrationTracker } from '../pushTokenRegistration';

describe('pushTokenRegistration', () => {
  describe('shouldRegisterToken', () => {
    it('should return true when user and token are present and user ID changed', () => {
      const result = shouldRegisterToken({
        currentUserId: 'user-1',
        previousUserId: null,
        expoPushToken: 'test-token',
        previousToken: null,
      });

      expect(result).toBe(true);
    });

    it('should return false when user ID and token have not changed', () => {
      const result = shouldRegisterToken({
        currentUserId: 'user-1',
        previousUserId: 'user-1',
        expoPushToken: 'test-token',
        previousToken: 'test-token',
      });

      expect(result).toBe(false);
    });

    it('should return true when token changes for same user', () => {
      const result = shouldRegisterToken({
        currentUserId: 'user-1',
        previousUserId: 'user-1',
        expoPushToken: 'new-token',
        previousToken: 'old-token',
      });

      expect(result).toBe(true);
    });

    it('should return false when no user', () => {
      const result = shouldRegisterToken({
        currentUserId: null,
        previousUserId: null,
        expoPushToken: 'test-token',
        previousToken: null,
      });

      expect(result).toBe(false);
    });

    it('should return false when no token', () => {
      const result = shouldRegisterToken({
        currentUserId: 'user-1',
        previousUserId: null,
        expoPushToken: null,
        previousToken: null,
      });

      expect(result).toBe(false);
    });

    it('should return true when switching users', () => {
      const result = shouldRegisterToken({
        currentUserId: 'user-2',
        previousUserId: 'user-1',
        expoPushToken: 'test-token',
        previousToken: 'test-token',
      });

      expect(result).toBe(true);
    });

    it('should return true when user logs back in after logout', () => {
      const result = shouldRegisterToken({
        currentUserId: 'user-1',
        previousUserId: null,
        expoPushToken: 'test-token',
        previousToken: null,
      });

      expect(result).toBe(true);
    });
  });

  describe('createTokenRegistrationTracker', () => {
    it('should track user ID changes and call registerToken when needed', () => {
      const mockRegisterToken = jest.fn();
      const tracker = createTokenRegistrationTracker(mockRegisterToken);

      // Initial login
      tracker.update({ userId: 'user-1', expoPushToken: 'test-token' });

      expect(mockRegisterToken).toHaveBeenCalledWith('user-1');
      expect(mockRegisterToken).toHaveBeenCalledTimes(1);
    });

    it('should not call registerToken when user ID stays the same', () => {
      const mockRegisterToken = jest.fn();
      const tracker = createTokenRegistrationTracker(mockRegisterToken);

      tracker.update({ userId: 'user-1', expoPushToken: 'test-token' });
      tracker.update({ userId: 'user-1', expoPushToken: 'test-token' });

      expect(mockRegisterToken).toHaveBeenCalledTimes(1);
    });

    it('should call registerToken again when user logs out and logs back in', () => {
      const mockRegisterToken = jest.fn();
      const tracker = createTokenRegistrationTracker(mockRegisterToken);

      // User logs in
      tracker.update({ userId: 'user-1', expoPushToken: 'test-token' });
      expect(mockRegisterToken).toHaveBeenCalledTimes(1);

      // User logs out
      tracker.update({ userId: null, expoPushToken: 'test-token' });
      expect(mockRegisterToken).toHaveBeenCalledTimes(1); // No call during logout

      // User logs back in
      tracker.update({ userId: 'user-1', expoPushToken: 'test-token' });
      expect(mockRegisterToken).toHaveBeenCalledTimes(2); // Called again
      expect(mockRegisterToken).toHaveBeenNthCalledWith(2, 'user-1');
    });

    it('should call registerToken for different user', () => {
      const mockRegisterToken = jest.fn();
      const tracker = createTokenRegistrationTracker(mockRegisterToken);

      tracker.update({ userId: 'user-1', expoPushToken: 'test-token' });
      tracker.update({ userId: null, expoPushToken: 'test-token' });
      tracker.update({ userId: 'user-2', expoPushToken: 'test-token' });

      expect(mockRegisterToken).toHaveBeenCalledTimes(2);
      expect(mockRegisterToken).toHaveBeenNthCalledWith(1, 'user-1');
      expect(mockRegisterToken).toHaveBeenNthCalledWith(2, 'user-2');
    });

    it('should not call registerToken when token is missing', () => {
      const mockRegisterToken = jest.fn();
      const tracker = createTokenRegistrationTracker(mockRegisterToken);

      tracker.update({ userId: 'user-1', expoPushToken: null });

      expect(mockRegisterToken).not.toHaveBeenCalled();
    });

    it('should call registerToken when token changes for same user', () => {
      const mockRegisterToken = jest.fn();
      const tracker = createTokenRegistrationTracker(mockRegisterToken);

      // Initial login
      tracker.update({ userId: 'user-1', expoPushToken: 'token-1' });
      expect(mockRegisterToken).toHaveBeenCalledTimes(1);

      // Token changes (e.g., app reinstall)
      tracker.update({ userId: 'user-1', expoPushToken: 'token-2' });
      expect(mockRegisterToken).toHaveBeenCalledTimes(2);
      expect(mockRegisterToken).toHaveBeenNthCalledWith(2, 'user-1');
    });
  });
});

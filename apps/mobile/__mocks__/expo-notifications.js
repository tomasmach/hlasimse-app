module.exports = {
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-id'),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  setBadgeCountAsync: jest.fn().mockResolvedValue(true),
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 1,
  },
  AndroidImportance: {
    HIGH: 4,
  },
};

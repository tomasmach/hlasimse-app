module.exports = {
  scheduleNotificationAsync: jest.fn().mockResolvedValue('mock-id'),
  getAllScheduledNotificationsAsync: jest.fn().mockResolvedValue([]),
  cancelScheduledNotificationAsync: jest.fn().mockResolvedValue(undefined),
  SchedulableTriggerInputTypes: {
    TIME_INTERVAL: 1,
  },
  AndroidImportance: {
    HIGH: 4,
  },
};

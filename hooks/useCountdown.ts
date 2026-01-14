import { useState, useEffect, useCallback } from "react";

export interface CountdownResult {
  hours: number;
  minutes: number;
  seconds: number;
  isExpired: boolean;
  formatted: string;
}

function calculateTimeRemaining(deadline: string | null): CountdownResult {
  if (!deadline) {
    return {
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: true,
      formatted: "00:00:00",
    };
  }

  const now = Date.now();
  const deadlineTime = new Date(deadline).getTime();
  const diff = deadlineTime - now;

  if (diff <= 0) {
    return {
      hours: 0,
      minutes: 0,
      seconds: 0,
      isExpired: true,
      formatted: "00:00:00",
    };
  }

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const formatted = [hours, minutes, seconds]
    .map((n) => n.toString().padStart(2, "0"))
    .join(":");

  return {
    hours,
    minutes,
    seconds,
    isExpired: false,
    formatted,
  };
}

export function useCountdown(deadline: string | null): CountdownResult {
  const [countdown, setCountdown] = useState<CountdownResult>(() =>
    calculateTimeRemaining(deadline)
  );

  const updateCountdown = useCallback(() => {
    setCountdown(calculateTimeRemaining(deadline));
  }, [deadline]);

  useEffect(() => {
    // Recalculate immediately when deadline changes
    updateCountdown();

    // Set up interval to update every second
    const intervalId = setInterval(updateCountdown, 1000);

    // Clean up interval on unmount or when deadline changes
    return () => clearInterval(intervalId);
  }, [updateCountdown]);

  return countdown;
}

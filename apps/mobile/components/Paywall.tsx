// RevenueCat temporarily disabled - Paywall is a no-op
// TODO: Re-enable when implementing subscriptions

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function Paywall({ visible, onClose, onSuccess }: PaywallProps) {
  // All features are free - paywall should never be shown
  // If somehow visible, immediately close
  if (visible) {
    onSuccess?.();
    onClose();
  }
  return null;
}

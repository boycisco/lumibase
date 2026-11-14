import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  XCircle,
} from 'lucide-react';
import type { PaymentStatus } from '@/lib/lumibase/types';

interface StatusIndicatorProps {
  status: PaymentStatus;
}

const STATUS_STYLES: Record<
  PaymentStatus,
  {
    label: string;
    toneClass: string;
    Icon: typeof Clock;
    spin?: boolean;
  }
> = {
  pending: {
    label: 'Pending',
    toneClass: 'text-amber-700 bg-amber-50 border-amber-200',
    Icon: Clock,
  },
  processing: {
    label: 'Processing',
    toneClass: 'text-blue-700 bg-blue-50 border-blue-200',
    Icon: Loader2,
    spin: true,
  },
  confirmed: {
    label: 'Confirmed',
    toneClass: 'text-emerald-700 bg-emerald-50 border-emerald-200',
    Icon: CheckCircle2,
  },
  underpaid: {
    label: 'Underpaid (Terminal)',
    toneClass: 'text-amber-800 bg-amber-50 border-amber-300',
    Icon: AlertTriangle,
  },
  overpaid: {
    label: 'Overpaid (Terminal)',
    toneClass: 'text-amber-800 bg-amber-50 border-amber-300',
    Icon: AlertTriangle,
  },
  expired: {
    label: 'Expired (Terminal)',
    toneClass: 'text-red-700 bg-red-50 border-red-200',
    Icon: XCircle,
  },
  cancelled: {
    label: 'Cancelled (Terminal)',
    toneClass: 'text-slate-700 bg-slate-100 border-slate-300',
    Icon: XCircle,
  },
  failed: {
    label: 'Failed (Reserved)',
    toneClass: 'text-red-700 bg-red-50 border-red-200',
    Icon: XCircle,
  },
};

export function StatusIndicator({ status }: StatusIndicatorProps) {
  const config = STATUS_STYLES[status];
  const { Icon } = config;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold whitespace-nowrap shrink-0 ${config.toneClass}`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${config.spin ? 'animate-spin' : ''}`}
        aria-hidden="true"
      />
      <span>{config.label}</span>
    </span>
  );
}

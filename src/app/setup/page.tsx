import { ComingSoon } from '@/components/coming-soon';

// Setup wizard (spec §17) — 8 steps. Built incrementally alongside the
// Google Cloud connector since step 2-6 depend on it directly.
export default function SetupPage() {
  return <ComingSoon title="אשף התקנה" phase="Phase 1" />;
}

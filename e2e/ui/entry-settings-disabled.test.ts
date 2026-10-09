import { test } from '@/playwright/suite';

// The upstream entry-settings shard is composed of authenticated AMR/Home,
// Team, connector, and account-shell journeys that Creator Studio Design does
// not ship. Keep the matrix topology explicit while leaving supported package,
// daemon, visual, and project-runtime coverage active.
test.describe.skip('upstream entry-settings journeys are outside Creator Studio Design scope', () => {
  test('[P0] unsupported upstream entry-settings surface', () => {});
});

'use client';

import { useEffect } from 'react';
import { setHostPetVisible } from '@open-design/host';

// Creator Studio Design uses the Scale mark as its sole floating desktop
// identity. The inherited companion/pet window is intentionally disabled so a
// legacy mascot cannot appear over the branded authentication or workspace UI.
export function DesktopPetSurface() {
  useEffect(() => {
    setHostPetVisible(false);
  }, []);
  return null;
}

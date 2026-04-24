/**
 * Theme Storage Module
 * Manages theme selection and persistence
 */

export type ThemeName = 'dark' | 'midnight' | 'ocean' | 'light';

export interface Theme {
  name: ThemeName;
  displayName: string;
  icon: string;
}

export const THEMES: Theme[] = [
  { name: 'dark',     displayName: 'Dark',     icon: '../../icons/theme-dark.png' },
  { name: 'midnight', displayName: 'Midnight', icon: '../../icons/theme-midnight.png' },
  { name: 'ocean',    displayName: 'Ocean',    icon: '../../icons/theme-ocean.png' },
  { name: 'light',    displayName: 'Light',    icon: '../../icons/theme-light.png' }
];

const STORAGE_KEY = 'selectedTheme';

/**
 * Get the currently selected theme
 */
export async function getTheme(): Promise<ThemeName> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    return (result[STORAGE_KEY] as ThemeName) || 'dark';
  } catch (err) {
    // console.error('[Theme] Error getting theme:', err);
    return 'dark';
  }
}

/**
 * Save the selected theme
 */
export async function saveTheme(theme: ThemeName): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: theme });
    // console.log('[Theme] Saved theme:', theme);
  } catch (err) {
    // console.error('[Theme] Error saving theme:', err);
  }
}

/**
 * Apply theme to the document
 */
export function applyTheme(theme: ThemeName): void {
  document.body.classList.remove('theme-dark', 'theme-midnight', 'theme-ocean', 'theme-light');
  document.body.classList.add(`theme-${theme}`);

  // Swap wallet icon based on theme
  const walletImg = document.getElementById('wallet-icon-img') as HTMLImageElement | null;
  if (walletImg) {
    walletImg.src = theme === 'light'
      ? '../../icons/wallet.png'
      : '../../icons/wallet-dark.png';
  }

  // console.log('[Theme] Applied theme:', theme);
}

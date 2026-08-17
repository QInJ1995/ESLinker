import { computed, ref } from 'vue'
import { darkTheme } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'

export type ThemePref = 'light' | 'dark'

const KEY = 'eslinker-theme'

function safeLoad(): ThemePref {
  try {
    return localStorage.getItem(KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

export const themePref = ref<ThemePref>(safeLoad())

export const naiveTheme = computed<GlobalTheme | null>(() =>
  themePref.value === 'dark' ? darkTheme : null
)

export function setTheme(pref: ThemePref): void {
  themePref.value = pref
  try {
    localStorage.setItem(KEY, pref)
  } catch {
    // ignore persistence failures
  }
  document.documentElement.classList.toggle('dark', pref === 'dark')
}

export function toggleTheme(): ThemePref {
  const next: ThemePref = themePref.value === 'dark' ? 'light' : 'dark'
  setTheme(next)
  return next
}

export function initTheme(): void {
  setTheme(themePref.value)
}

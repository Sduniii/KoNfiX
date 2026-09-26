import React, { createContext, useContext, useState, useEffect, ReactNode, useMemo } from 'react'
import { Locale, Translations, LanguageOption } from './types'
import { de } from './locales/de'
import { en } from './locales/en'

export const AVAILABLE_LANGUAGES: LanguageOption[] = [
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
  { code: 'en', label: 'English', flag: '🇬🇧' },
]

const STORAGE_KEY = 'konfix_language'

const TRANSLATIONS: Record<Locale, Translations> = {
  de,
  en,
}

interface I18nContextType {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: (path: string, params?: Record<string, string | number>) => string
  translations: Translations
  languages: LanguageOption[]
}

const I18nContext = createContext<I18nContextType | null>(null)

function resolveDotPath(obj: any, path: string): string | undefined {
  const parts = path.split('.')
  let current: any = obj
  for (const part of parts) {
    if (current && typeof current === 'object' && part in current) {
      current = current[part]
    } else {
      return undefined
    }
  }
  return typeof current === 'string' ? current : undefined
}

export const I18nProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(() => {
    // 1. Check localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored === 'de' || stored === 'en') {
        return stored
      }
    } catch {
      // Ignore localStorage access errors
    }

    // 2. Check browser language
    try {
      if (typeof navigator !== 'undefined' && navigator.language) {
        if (navigator.language.toLowerCase().startsWith('de')) {
          return 'de'
        }
      }
    } catch {
      // Ignore navigator errors
    }

    // Default to German for KoNfiX
    return 'de'
  })

  const setLocale = (newLocale: Locale) => {
    setLocaleState(newLocale)
    try {
      localStorage.setItem(STORAGE_KEY, newLocale)
    } catch {
      // Ignore
    }
  }

  const translations = useMemo(() => TRANSLATIONS[locale] || TRANSLATIONS.de, [locale])

  const t = useMemo(() => {
    return (path: string, params?: Record<string, string | number>): string => {
      // Look up in current locale
      let text = resolveDotPath(translations, path)
      
      // Fallback to German if not found in current locale
      if (text === undefined && locale !== 'de') {
        text = resolveDotPath(TRANSLATIONS.de, path)
      }

      // If still not found, return the path key as fallback
      if (text === undefined) {
        return path
      }

      // Variable interpolation: replaces {paramName} with value
      if (params) {
        return text.replace(/\{(\w+)\}/g, (_, key) => {
          return params[key] !== undefined ? String(params[key]) : `{${key}}`
        })
      }

      return text
    }
  }, [translations, locale])

  return (
    <I18nContext.Provider
      value={{
        locale,
        setLocale,
        t,
        translations,
        languages: AVAILABLE_LANGUAGES,
      }}
    >
      {children}
    </I18nContext.Provider>
  )
}

export function useTranslation() {
  const context = useContext(I18nContext)
  if (!context) {
    throw new Error('useTranslation must be used within an I18nProvider')
  }
  return context
}

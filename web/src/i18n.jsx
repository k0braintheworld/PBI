import { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import { EN } from './i18n.en.js';

/**
 * i18n ligero y sin dependencias.
 *
 * El idioma de origen es el español: las cadenas en el código están en español y
 * `t('texto en español')` las devuelve tal cual en modo ES, o su traducción del
 * diccionario `EN` en modo EN (si falta una entrada, cae al español).
 *
 * El idioma inicial se detecta del navegador (es → español, resto → inglés) y la
 * elección manual se recuerda en localStorage.
 */

function detectInitial() {
  try {
    const saved = localStorage.getItem('pbi_lang');
    if (saved === 'es' || saved === 'en') return saved;
  } catch { /* ignore */ }
  const nav = (typeof navigator !== 'undefined' && (navigator.language || (navigator.languages && navigator.languages[0]))) || 'es';
  return /^es/i.test(nav) ? 'es' : 'en';
}

const LangCtx = createContext(null);

// Idioma a nivel de módulo, para traducir desde funciones que no son componentes
// React (formateadores de fecha/tamaño, etc.). Lo mantiene actualizado el provider.
let _moduleLang = detectInitial();
export const moduleLang = () => _moduleLang;
/** Traductor global (no reactivo): úsalo en helpers fuera de componentes. */
export const tg = (s) => (_moduleLang === 'en' ? (EN[s] ?? s) : s);

export function LanguageProvider({ children }) {
  const [lang, setLangState] = useState(detectInitial);
  const setLang = useCallback((l) => {
    const v = l === 'en' ? 'en' : 'es';
    _moduleLang = v;
    try { localStorage.setItem('pbi_lang', v); } catch { /* ignore */ }
    setLangState(v);
  }, []);
  useEffect(() => { try { document.documentElement.lang = lang; } catch { /* ignore */ } }, [lang]);
  const value = useMemo(() => ({
    lang,
    setLang,
    t: (s) => (lang === 'en' ? (EN[s] ?? s) : s),
  }), [lang, setLang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export function useI18n() {
  return useContext(LangCtx) || { lang: 'es', setLang: () => {}, t: (s) => s };
}

export const useT = () => useI18n().t;

/** Conmutador ES / EN (se usa en la barra lateral). */
export function LangSwitch() {
  const { lang, setLang } = useI18n();
  return (
    <div className="lang-switch" role="group" aria-label="Idioma / Language">
      <button className={lang === 'es' ? 'active' : ''} onClick={() => setLang('es')} title="Español">ES</button>
      <button className={lang === 'en' ? 'active' : ''} onClick={() => setLang('en')} title="English">EN</button>
    </div>
  );
}

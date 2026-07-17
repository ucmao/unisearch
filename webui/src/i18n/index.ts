import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

// 中文翻译
import zhCommon from './locales/zh-CN/common.json'
import zhConfig from './locales/zh-CN/config.json'
import zhTerminal from './locales/zh-CN/terminal.json'
import zhEnv from './locales/zh-CN/env.json'

const resources = {
  'zh-CN': {
    common: zhCommon,
    config: zhConfig,
    terminal: zhTerminal,
    env: zhEnv,
  },
}

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'zh-CN',
    fallbackLng: 'zh-CN',
    defaultNS: 'common',
    interpolation: {
      escapeValue: false,
    },
  })

export default i18n

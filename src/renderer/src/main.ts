import './assets/main.css'

import { createApp } from 'vue'
import naive from 'naive-ui'
import App from './App.vue'
import { initTheme } from './lib/theme'

initTheme()

createApp(App).use(naive).mount('#app')

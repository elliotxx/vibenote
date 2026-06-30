import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import './style.css'
import { installDevMock } from './devMock'

installDevMock()
createApp(App).use(createPinia()).mount('#app')

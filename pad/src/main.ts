import { setLanguage } from './i18n';
import { createApp } from 'vue';
import App from './App.vue';
import Shortcuts from './Shortcuts.vue';
import './style.css';
import './themes.css';
async function mount() {
  setLanguage(await window.labpad.interfaceLanguage());
  createApp(location.hash === '#shortcuts' ? Shortcuts : App).mount('#app');
}
void mount();

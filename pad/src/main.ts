import {createApp} from 'vue';
import App from './App.vue';
import Shortcuts from './Shortcuts.vue';
import './style.css';
import './themes.css';
createApp(location.hash==='#shortcuts'?Shortcuts:App).mount('#app');

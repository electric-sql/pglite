// .vitepress/theme/index.js
import { h } from 'vue'
import DefaultTheme from 'vitepress/theme-without-fonts'
import './custom.css'
import HeroImage from '../../components/HeroImage.vue'

export default {
  extends: DefaultTheme,
  Layout() {
    return h(DefaultTheme.Layout, null, {
      'home-hero-image': () => h(HeroImage),
    })
  },
}

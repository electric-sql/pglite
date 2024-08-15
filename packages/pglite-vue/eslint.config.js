import rootConfig from '../../eslint.config.js'
import pluginVue from 'eslint-plugin-vue'

export default [...rootConfig, ...pluginVue.configs['flat/base']]

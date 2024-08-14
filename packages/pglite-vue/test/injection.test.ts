import { describe, it, expect, afterEach } from 'vitest'
import { cleanup, render, waitFor } from '@testing-library/vue'
import { computed, defineComponent, isVue3, ref, shallowRef } from 'vue-demi'
import { isProxy } from 'vue'
import { PGlite } from '@electric-sql/pglite'
import { live } from '@electric-sql/pglite/live'
import { makePGliteDependencyInjector } from '../src'

if (isVue3) {
  describe('dependency injection', () => {
    afterEach(() => {
      cleanup()
    })

    it('works without reference to client', async () => {
      const db = await PGlite.create({
        extensions: {
          live,
        },
      })
      const { providePGlite, injectPGlite } =
        makePGliteDependencyInjector<typeof db>()

      const ProviderComponent = defineComponent({
        template: '<div v-if={show}><slot/></div>',
        setup() {
          providePGlite(db)
          return { show: true }
        },
      })

      const ConsumerComponent = defineComponent({
        template: '<div>count: {{ count }}</div>',
        setup() {
          const db = injectPGlite()
          const count = ref(0)
          db?.exec(`SELECT 1 as count;`).then((res) => {
            count.value = res[0].rows[0]['count']
          })
          return { count }
        },
      })

      const wrapper = render({
        template: '<ProviderComponent><ConsumerComponent/></ProviderComponent>',
        components: { ProviderComponent, ConsumerComponent },
      })

      await waitFor(() => expect(wrapper.getByText('count: 1')).toBeTruthy())
    })

    it('works with shallow reference to client', async () => {
      const db = await PGlite.create({
        extensions: {
          live,
        },
      })

      const { providePGlite, injectPGlite } =
        makePGliteDependencyInjector<typeof db>()

      const ProviderComponent = defineComponent({
        template: '<div v-if=show><slot/></div>',
        setup() {
          const dbRef = shallowRef()
          const show = computed(() => dbRef.value !== undefined)
          setTimeout(() => (dbRef.value = db), 200)
          providePGlite(dbRef)
          return { show }
        },
      })

      let dbInstance: typeof db | undefined

      const ConsumerComponent = defineComponent({
        template: '<div>count: {{ count }}</div>',
        setup() {
          const db = injectPGlite()
          dbInstance = db
          const count = ref(0)
          db?.exec(`SELECT 1 as count;`).then((res) => {
            count.value = res[0].rows[0]['count']
          })

          return { count }
        },
      })

      const wrapper = render({
        template: '<ProviderComponent><ConsumerComponent/></ProviderComponent>',
        components: { ProviderComponent, ConsumerComponent },
      })

      await waitFor(() => expect(wrapper.getByText('count: 1')).toBeTruthy())

      // consumer's instance should not be a proxy
      expect(!isProxy(dbInstance)).true
    })
  })
} else {
  it('dummy', () => {})
}

{
  const originalConsoleLog = window.console.log
  window.console.log = function (...args) {
    originalConsoleLog(...args)
    const log = document.getElementById('log')
    const el = document.createElement('div')
    el.classList.add('log-entry')
    if (args.length !== 1) {
      el.innerText = JSON.stringify(args, null, 2)
    } else {
      try {
        el.innerText +=
          typeof args[0] === 'string'
            ? args.join(' ')
            : JSON.stringify(args[0], null, 2)
      } catch (e) {
        el.innerText = args[0].toString()
      }
    }
    log.appendChild(el)
  }

  document.addEventListener('DOMContentLoaded', async () => {
    document.body.querySelectorAll('script[src]').forEach(async (script) => {
      const source = fetch(script.src).then((res) => res.text())
      const code = await source
      script.textContent = code
    })
    document.body.querySelectorAll('div.script[rel]').forEach(async (el) => {
      const source = fetch(el.getAttribute('rel')).then((res) => res.text())
      const code = await source
      el.textContent = code
    })
  })
}

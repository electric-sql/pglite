'use strict'

var readline = { last_cx: -1, index: 0, history: ['help()'] }

// two modes based on RAW_MODE: default readline emulation or vm.rawstdin

readline.complete = function (line) {
  if (readline.history[readline.history.length - 1] != line)
    readline.history.push(line)
  readline.index = 0
  vm.readline(line + '\n')
}

if (!window.Terminal) {
  if (window.vm) {
    var xterm_cdn
    if (window.vm.config && window.vm.config.cdn) {
      xterm_cdn = window.vm.config.cdn + 'vt/'
      console.log('Terminal+ImageAddon importing from CDN :', xterm_cdn)
    } else {
      xterm_cdn = xterm_cdn || 'https://pygame-web.github.io/archives/vt/'
      console.warn('Terminal+ImageAddon importing from fallback ', xterm_cdn)
    }

    for (const css of ['xterm.css']) {
      const cssref = document.createElement('link')
      cssref.setAttribute('rel', 'stylesheet')
      cssref.setAttribute('type', 'text/css')
      cssref.setAttribute('href', xterm_cdn + css)
      document.getElementsByTagName('head')[0].appendChild(cssref)
    }

    await import(xterm_cdn + 'xterm.js')
    await import(xterm_cdn + 'xterm-addon-image.js')
  } else {
    console.error('only use import for vtx.js module')
  }
} else {
  console.warn('Terminal+ImageAddon were inlined')
}

export class WasmTerminal {
  constructor(hostid, cols, rows, fontsize, is_fbdev, addons_list) {
    this.input = ''
    this.resolveInput = null
    this.activeInput = true
    this.inputStartCursor = null

    this.nodup = 1
    var theme = {
      background: '#1a1c1f',
    }

    var transparency = false
    var sback = 1000

    if (is_fbdev) {
      theme = {
        foreground: '#ffffff',
        background: 'rgba(0, 0, 0, 0)',
      }
      sback = 0
      transparency = true
    }

    this.xterm = new Terminal({
      //              rendererType : "dom",
      rendererType: 'webgl',
      experimentalCharAtlas: 'webgl',
      theme: theme,
      allowTransparency: transparency,
      allowProposedApi: true, // xterm 0.5 + sixel
      scrollback: sback,
      fontFamily: 'Courier-new, courier, monospace',
      fontSize: fontsize || 12,
      cols: cols || 132,
      rows: rows || 32,
    })

    if (typeof Worker !== 'undefined') {
      for (const addon of addons_list || []) {
        console.warn(hostid, cols, rows, addon)
        const imageAddon = new ImageAddon.ImageAddon(addon.url, addon)
        this.xterm.loadAddon(imageAddon)
        this.sixel = function write(data) {
          this.xterm.write(data)
        }
      }
    } else {
      console.warn('No worker support, not loading xterm addons')
      this.sixel = function ni() {
        console.warn('SIXEL N/I')
      }
    }

    this.xterm.open(document.getElementById(hostid))

    this.xterm.onKey((keyEvent) => {
      // Fix for iOS Keyboard Jumping on space
      if (keyEvent.key === ' ') {
        keyEvent.domEvent.preventDefault()
      }
    })

    this.xterm.onData(this.handleTermData)
  }

  open(container) {
    this.xterm.open(container)
  }

  ESC() {
    for (var i = 0; i < arguments.length; i++)
      this.xterm.write('\x1b' + arguments[i])
  }

  handleTermData = (data) => {
    // TODO: check mouse Y pos for raw mode in debug mode
    if (window.RAW_MODE) {
      vm.rawstdin(data)
      return
    }

    const ord = data.charCodeAt(0)
    let ofs

    const cx = this.xterm.buffer.active.cursorX

    // TODO: Handle ANSI escape sequences
    if (ord === 0x1b) {
      // Handle special characters
      switch (data.charCodeAt(1)) {
        case 0x5b:
          const cursor = readline.history.length + readline.index
          var histo = '>h> '

          switch (data.charCodeAt(2)) {
            // "?"
            case 63:
              const c4 = data.charCodeAt(4)
              const c5 = data.charCodeAt(5)
              if (c4 == 54 && c5 == 99) {
                // Primary Device Attribute of Sixel support : 4
                // "?6c" https://github.com/odknt/st/issues/1
                console.log('query')
              }

            case 65:
              //console.log("VT UP")
              // memo cursor pos before entering histo
              if (!readline.index) {
                if (readline.last_cx < 0) {
                  readline.last_cx = cx
                  readline.buffer = this.input
                }
                // TODO: get current line content from XTERM
              }

              if (cursor > 0) {
                readline.index--
                histo = '>h> ' + readline.history[cursor - 1]
                //console.log(__FILE__," histo-up  :", readline.index, cursor, histo)

                this.ESC('[132D', '[2K')
                this.xterm.write(histo)
                this.input = histo.substr(4)
              }
              break

            case 66:
              //console.log("VT DOWN")
              if (readline.index < 0) {
                readline.index++
                histo = histo + readline.history[cursor]
                this.ESC('[132D', '[2K')
                this.xterm.write(histo)
                this.input = histo.substr(4)
              } else {
                // we are back
                if (readline.last_cx >= 0) {
                  histo = histo + readline.buffer
                  readline.buffer = ''
                  this.ESC('[2K')
                  this.ESC('[132D')
                  this.xterm.write(histo)
                  this.input = histo.substr(4)
                  this.ESC('[132D')
                  this.ESC('[' + readline.last_cx + 'C')
                  //console.log(__FILE__," histo-back", readline.index, cursor, histo)
                  readline.last_cx = -1
                }
              }
              break

            case 67:
              //console.log("VT RIGHT")
              break

            case 68:
              //console.log("VT LEFT")
              break

            case 60:
              //  vm.rawstdin(data)
              break

            default:
              console.log(__FILE__, 'VT unhandled ? ' + data.charCodeAt(2))
          }
          break
        default:
          console.log(__FILE__, 'VT ESC ' + data.charCodeAt(1))
      }
    } else if (ord < 32 || ord === 0x7f) {
      switch (data) {
        case '\r': // ENTER
        case '\x0a': // CTRL+J
        case '\x0d': // CTRL+M
          this.xterm.write('\r\n')
          readline.complete(this.input)
          this.input = ''
          break
        case '\x7F': // BACKSPACE
        case '\x08': // CTRL+H
        case '\x04': // CTRL+D
          this.handleCursorErase(true)
          break

        case '\0x03': // CTRL+C
          break

        // ^L for clearing VT but keep X pos.
        case '\x0c':
          const cy = this.xterm.buffer.active.cursorY

          if (cy < this.xterm.rows) this.ESC('[B', '[J', '[A')

          this.ESC('[A', '[K', '[1J')

          for (var i = 1; i < cy; i++) {
            this.ESC('[A', '[M')
          }

          this.ESC('[M')

          if (cx > 0) this.ESC('[' + cx + 'C')
          break

        default:
          switch (ord) {
            case 3:
              readline.complete('raise KeyboardInterrupt')
              break
            default:
              console.log('vt:' + ord)
          }
      }
    } else {
      this.input += data
      this.xterm.write(data)
    }
  }

  handleCursorErase() {
    // Don't delete past the start of input
    if (this.xterm.buffer.active.cursorX <= this.inputStartCursor) {
      return
    }
    this.input = this.input.slice(0, -1)
    this.xterm.write('\x1B[D')
    this.xterm.write('\x1B[P')
  }

  clear() {
    this.xterm.clear()
  }

  // direct write
  sixel(data) {
    this.xterm.write(data)
  }

  print(message) {
    const normInput = message.replace(/[\r\n]+/g, '\n').replace(/\n/g, '\r\n')
    this.xterm.write(normInput)
  }
}

window.WasmTerminal = WasmTerminal
window.readline = readline

"use strict";
console.info(' -------- pgbuild module loading .... ------');

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// https://developer.mozilla.org/en-US/docs/Glossary/Global_object
const window = globalThis

async function boot(opts) {
	if (!opts) {
		console.warn("PGlite: setting defaults to node module");
		const no = "N"
		const yes = "Y"
		opts = {
			"argv" : [],

			"env" : {
				"PGDATA" : "/tmp/pglite/base",
				"PREFIX" : "/tmp/pglite",
				"REPL" : no,
			},

			"mem" : {
				1 : 'SELECT null as "Hello world"'
			}
		}
	}

    function fnc_stdout(code) {

        var flush = (code == 4)

        if (flush) {
            flushed_stdout = true
        } else {
            if (code == 10) {
                if (flushed_stdout) {
                    flushed_stdout = false
                    return
                }

                buffer_stdout += "\r\n";
                flush = true
            }
            flushed_stdout = false
        }

        if (buffer_stdout != "") {
            if (flush) {
                if (buffer_stdout.startsWith(sixel_prefix)) {
                    console.info("[sixel image]");
                    Module.vt.sixel(buffer_stdout);
                } else {
                    if (buffer_stdout.startsWith("Looks like you are rendering"))
                        return;

                    Module.vt.xterm.write( b_utf8(buffer_stdout) )
                }
                buffer_stdout = ""
                return
            }
        }
        if (!flush)
            buffer_stdout += String.fromCharCode(code);
    }

    function fnc_stderr(c) {
        if (!stderr_on) {
            stderr_on = true
            Module.vt.xterm.write("\x1B[1;3;31m")
        }
        if (c==10) {
            if (stderr_on) {
                stderr_on = false
                Module.vt.xterm.write('\x1B[0m')
            }
            Module.vt.xterm.write("\r\n")
        } else
            Module.vt.xterm.write( String.fromCharCode(c) )
    }

    function fnc_stdin() {
        if (test_data.length>0) {
            const c = test_data.shift()
            return c
        }
// should never happen, blocking !
        console.error("pump", "EOF")
        return null;
    }

    window.stderr_on = false
    window.fnc_stdout = fnc_stdout
    window.fnc_stderr = fnc_stderr
    window.fnc_stdin = fnc_stdin


    window.test_step = 0
    window.test_data = []

    globalThis.text_codec = new TextDecoder()
    const sixel_prefix = String.fromCharCode(27)+"Pq"

    function b_utf8(s) {
        var ary = []
        for ( var i=0; i<s.length; i+=1 ) {
            ary.push( s.substr(i,1).charCodeAt(0) )
        }
        return text_codec.decode(  new Uint8Array(ary) )
    }


    function test_drive(step) {
        var data = null
        switch (test_step) {
            case 0:
                data = "SHOW client_encoding;";
                break

            case 1:
                data = "SELECT 'é';"
                break

            case 2:
                data = "SELECT now();"
                break

        }

        if (data!=null) {
            test_step++
            console.log("SQL:", data)
            Module.readline(data+"\n\n")
            setTimeout(test_drive, 2000);
        } else {
            console.log("SQL:End")
        }
    }

    function prerun(vm) {
        console.log("prerun(js)")

       	// heap corruption
        //const setenv = Module.cwrap('setenv', 'number', ['string','string','number']);
        //Module.ccall('setenv', ['number'], ['string', 'string', 'number'], k , v, 1)

		const opts = window.opts || Module.opts
       	var argv = opts.argv || []
       	while(argv.length) {
        	const arg = argv.shift()
			Module.arguments.push(arg)
		}

		for (const [k, v] of Object.entries(opts.env || {})) {
			Module.arguments.push(`${k}=${v}`)
			/*
			???? ReferenceError: Can't find variable: stringToUTF8
			stringToUTF8(k, 1, 1024);
        	stringToUTF8(v, 2048, 65535);
        	Module._setenv(1, 2048, 1);
        	*/

		}

    }


    function postrun() {
        console.log("postrun")
        //setTimeout(test_drive, 3000)
    }

    // ===============  db API ==============================

    function exec(query) {
		console.warn("exec():", query)
		//Module.readline('SELECT null as "Hello world";')
		Module.readline('SELECT now();')
		Module._interactive_one()
		//Module._interactive_one() // empty flush frame
		console.warn("exec():end")
		console.log("result:", text_codec.decode(Module.FS.readFile("/tmp/.s.PGSQL.5432.out")) )
	}

	function execProtocol(...args) {
		console.warn("execProtocol():", args)
	}

	// =======================================================

    // setting ENV won't work.
    var Module = {
    	thisProgram : "PGlite",
		arguments : [],
		opts : opts,
		noExitRuntime : true,
        config : {
            cdn : "https://pygame-web.github.io/archives/0.9/",
        },

        print: (()=>{
            return (...args) => {
            	var text = args.join(' ');
            	console.log(text);
            };

        })(),

        canvas: null,

/*
        stdin : fnc_stdin,
        stdout : fnc_stdout,
        stderr : fnc_stderr,
*/

		exec : exec,
		execProtocol: execProtocol,

        preRun : [ prerun ],
        postRun : [ postrun ],

        locateFile : function(path, prefix) {
        	console.log("locateFile: "+path+' '+prefix);
        	//if (!prefix)
        		//prefix = "/data/git/pg/pglite-server/node_modules/@electric-sql/pglite/dist/"
        	if (path == "libecpg.so")
        		path = "postgres.so"
            console.log("locateFile(fixed): "+path+' '+prefix);
            return prefix + path;
        },

        setStatus: (text) => {
        	console.log(text);
        },

        totalDependencies: 0,
        monitorRunDependencies: (left) => {
// REMOVE SPAM
        	return;
            Module.totalDependencies = Math.max(Module.totalDependencies, left);
            Module.setStatus(left ? 'Preparing... (' + (Module.totalDependencies-left) + '/' + Module.totalDependencies + ')' : 'All downloads complete.');
        },

        readline : function(line) {
            const ud = { "type" : "stdin", "data" : line }
            if (window.worker) {
                window.worker.postMessage({ target: 'custom', userData: ud });
            } else {
                this.postMessage(ud);
            }
        }
    };


    Module.setStatus('Downloading support files ...');


    window.onerror = () => {
    	Module.setStatus('Exception thrown, see JavaScript console');
	    Module.setStatus = (text) => {
            if (text) console.error('[post-exception status] ' + text);
        };
    };
    window.vm = Module
    window.Module = await initModule(vm)
    return window.Module
}

import initModule from "./pgbuild.js";

async function EmPostgresFactory(m){
	globalThis.is_worker = (typeof WorkerGlobalScope !== 'undefined') && self instanceof WorkerGlobalScope;
/*
	// stock loader calls initdb
	if (m && m.arguments && (m.arguments[0] == "--boot")) {
		console.log("EmPostgresFactory boot skip, worker==", is_worker)
		return sleep(0)
	}
*/
	console.log("EmPostgresFactory worker==", is_worker, m )
    return boot();
}


export default EmPostgresFactory

/**
 * @license
 * Copyright 2013 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

addToLibrary({
  $PGFS__deps: ['$FS', '$MEMFS', '$PATH'],
  $PGFS__postset: () => {
    addAtExit('PGFS.quit();');
    return '';
  },
  $PGFS: {
    dbs: {},
    indexedDB: () => {
      if (typeof indexedDB != 'undefined') return indexedDB;
      var ret = null;
      if (typeof window == 'object') ret = window.indexedDB || window.mozIndexedDB || window.webkitIndexedDB || window.msIndexedDB;
#if ASSERTIONS
      assert(ret, 'PGFS used, but indexedDB not supported');
#endif
      return ret;
    },
    DB_VERSION: 163,
    DB_STORE_NAME: 'PG',

    on_mount: () => {
        console.warn("pgfs", "mounted")
    },

    // Queues a new VFS -> PGFS synchronization operation
    queuePersist: (mount) => {
      function onPersistComplete() {
        if (mount.idbPersistState === 'again') startPersist(); // If a new sync request has appeared in between, kick off a new sync
        else mount.idbPersistState = 0; // Otherwise reset sync state back to idle to wait for a new sync later
      }
      function startPersist() {
        mount.idbPersistState = 'idb'; // Mark that we are currently running a sync operation
        PGFS.syncfs(mount, /*populate:*/false, onPersistComplete);
      }

      if (!mount.idbPersistState) {
        // Programs typically write/copy/move multiple files in the in-memory
        // filesystem within a single app frame, so when a filesystem sync
        // command is triggered, do not start it immediately, but only after
        // the current frame is finished. This way all the modified files
        // inside the main loop tick will be batched up to the same sync.
        mount.idbPersistState = setTimeout(startPersist, 0);
      } else if (mount.idbPersistState === 'idb') {
        // There is an active IndexedDB sync operation in-flight, but we now
        // have accumulated more files to sync. We should therefore queue up
        // a new sync after the current one finishes so that all writes
        // will be properly persisted.
        mount.idbPersistState = 'again';
      }
    },

    mount: (mount) => {
      // reuse core MEMFS functionality
      var mnt = MEMFS.mount(mount);
      // If the automatic PGFS persistence option has been selected, then automatically persist
      // all modifications to the filesystem as they occur.
      if (mount?.opts?.autoPersist) {
        mnt.idbPersistState = 0; // IndexedDB sync starts in idle state
        var memfs_node_ops = mnt.node_ops;
        mnt.node_ops = Object.assign({}, mnt.node_ops); // Clone node_ops to inject write tracking
        mnt.node_ops.mknod = (parent, name, mode, dev) => {
          var node = memfs_node_ops.mknod(parent, name, mode, dev);
          // Propagate injected node_ops to the newly created child node
          node.node_ops = mnt.node_ops;
          // Remember for each PGFS node which PGFS mount point they came from so we know which mount to persist on modification.
          node.PGFS_mount = mnt.mount;
          // Remember original MEMFS stream_ops for this node
          node.memfs_stream_ops = node.stream_ops;
          // Clone stream_ops to inject write tracking
          node.stream_ops = Object.assign({}, node.stream_ops);

          // Track all file writes
          node.stream_ops.write = (stream, buffer, offset, length, position, canOwn) => {
            // This file has been modified, we must persist IndexedDB when this file closes
            stream.node.isModified = true;
            return node.memfs_stream_ops.write(stream, buffer, offset, length, position, canOwn);
          };

          // Persist IndexedDB on file close
          node.stream_ops.close = (stream) => {
            var n = stream.node;
            if (n.isModified) {
              PGFS.queuePersist(n.PGFS_mount);
              n.isModified = false;
            }
            if (n.memfs_stream_ops.close) return n.memfs_stream_ops.close(stream);
          };

          return node;
        };
        // Also kick off persisting the filesystem on other operations that modify the filesystem.
        mnt.node_ops.mkdir   = (...args) => (PGFS.queuePersist(mnt.mount), memfs_node_ops.mkdir(...args));
        mnt.node_ops.rmdir   = (...args) => (PGFS.queuePersist(mnt.mount), memfs_node_ops.rmdir(...args));
        mnt.node_ops.symlink = (...args) => (PGFS.queuePersist(mnt.mount), memfs_node_ops.symlink(...args));
        mnt.node_ops.unlink  = (...args) => (PGFS.queuePersist(mnt.mount), memfs_node_ops.unlink(...args));
        mnt.node_ops.rename  = (...args) => (PGFS.queuePersist(mnt.mount), memfs_node_ops.rename(...args));
      }
      return mnt;
    },

    ext_ok : (...args) => {
      console.log("pgfs:ext OK", args);
    },

    ext_fail : (...args) => {
        console.log("pgfs:ext FAIL", args);
    },


    load_pg_extension: (ext, bytes) => {
        var data = tinyTar.untar(bytes);
        data.forEach(function(file) {
          if (!file.name.startsWith(".")) {
              const _file = "/tmp/pglite/" + file.name;
              console.log("    + ", _file);
              if (file.name.endsWith(".so")) {
                console.warn(_file, "scheduled for wasm streaming compilation");

    const ext_ok = (...args) => {
      console.log("pgfs:ext OK", _file, args);
    };

    const ext_fail = (...args) => {
        console.log("pgfs:ext FAIL", _file, args);
    };

                FS.createPreloadedFile(PATH.dirname(_file), PATH.basename(_file), file.data, true, true, ext_ok, ext_fail, false);
                console.log("createPreloadedFile called for :", _file);
              } else {
                FS.writeFile(_file, file.data);
              }
          }
        });
        console.warn("pgfs ext:end", ext);
    },


    load_package: async (ext, url) => {
        var bytes;
        var response;
        if (FS.analyzePath(url).exists) {
            console.error("PGFS TODO: handle local archives", url)
        } else {
            console.error("PGFS Fetching:", url)
            response = await fetch(url);
        }

        if (url.endsWith(".tar")) {
            const buffer = await response.arrayBuffer();
            bytes = new Uint8Array(buffer);
        } else {
           const ds = new DecompressionStream("gzip");
           const gzbytes = await response.blob();
             console.log("gzdata", gzbytes.size);
             const stream_in = gzbytes.stream().pipeThrough(ds);
             bytes = new Uint8Array(await new Response(stream_in).arrayBuffer());
        }
        PGFS.load_pg_extension(ext, bytes);
    },


    syncfs: (mount, populate, callback) => {
        if (populate) {
            const save_cb = callback;
            console.log("ext ?", Module.pg_extensions )

            callback = async function load_pg_extensions(arg) {
                for (const ext in Module.pg_extensions) {
                    var blob;
                    try {
                        blob = await Module.pg_extensions[ext]
                    } catch (x) {
                        console.error("failed to fetch extension :", ext)
                        continue
                    }
                    if (blob) {
                        const bytes = new Uint8Array(await blob.arrayBuffer())
                        console.log("  +", ext,"tardata:", bytes.length )
                        if (ext=="quack")
                           console.warn(ext,"skipped !")
                        else
                           PGFS.load_pg_extension(ext, bytes)
                    } else {
                       console.error("could not get binary data for extension :", ext);
                    }
                }
                return save_cb(arg);
            }
        }

      PGFS.getLocalSet(mount, (err, local) => {
        if (err) return callback(err);

        PGFS.getRemoteSet(mount, (err, remote) => {
          if (err) return callback(err);

          var src = populate ? remote : local;
          var dst = populate ? local : remote;

          PGFS.reconcile(src, dst, callback);
        });
      });
    },
    quit: () => {
      Object.values(PGFS.dbs).forEach((value) => value.close());
      PGFS.dbs = {};
    },
    getDB: (name, callback) => {
      // check the cache first
        name = name.split("/").pop() + "@⌁PGLite v16.3⌁";
      var db = PGFS.dbs[name];
      if (db) {
        return callback(null, db);
      }

      var req;
      try {
        req = PGFS.indexedDB().open(name, PGFS.DB_VERSION);
      } catch (e) {
        return callback(e);
      }
      if (!req) {
        return callback("Unable to connect to IndexedDB");
      }
      req.onupgradeneeded = (e) => {
        var db = /** @type {IDBDatabase} */ (e.target.result);
        var transaction = e.target.transaction;

        var fileStore;

        if (db.objectStoreNames.contains(PGFS.DB_STORE_NAME)) {
          fileStore = transaction.objectStore(PGFS.DB_STORE_NAME);
        } else {
          fileStore = db.createObjectStore(PGFS.DB_STORE_NAME);
        }

        if (!fileStore.indexNames.contains('timestamp')) {
          fileStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
      };
      req.onsuccess = () => {
        db = /** @type {IDBDatabase} */ (req.result);

        // add to the cache
        PGFS.dbs[name] = db;
        callback(null, db);
      };
      req.onerror = (e) => {
        callback(e.target.error);
        e.preventDefault();
      };
    },
    getLocalSet: (mount, callback) => {
      var entries = {};

      function isRealDir(p) {
        return p !== '.' && p !== '..';
      };
      function toAbsolute(root) {
        return (p) => PATH.join2(root, p);
      };

      var check = FS.readdir(mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));

      while (check.length) {
        var path = check.pop();
        var stat;

        try {
          stat = FS.stat(path);
        } catch (e) {
          return callback(e);
        }

        if (FS.isDir(stat.mode)) {
          check.push(...FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
        }

        entries[path] = { 'timestamp': stat.mtime };
      }

      return callback(null, { type: 'local', entries: entries });
    },
    getRemoteSet: (mount, callback) => {
      var entries = {};

      PGFS.getDB(mount.mountpoint, (err, db) => {
        if (err) return callback(err);

        try {
          var transaction = db.transaction([PGFS.DB_STORE_NAME], 'readonly');
          transaction.onerror = (e) => {
            callback(e.target.error);
            e.preventDefault();
          };

          var store = transaction.objectStore(PGFS.DB_STORE_NAME);
          var index = store.index('timestamp');

          index.openKeyCursor().onsuccess = (event) => {
            var cursor = event.target.result;

            if (!cursor) {
              return callback(null, { type: 'remote', db, entries });
            }

            entries[cursor.primaryKey] = { 'timestamp': cursor.key };

            cursor.continue();
          };
        } catch (e) {
          return callback(e);
        }
      });
    },
    loadLocalEntry: (path, callback) => {
      var stat, node;

      try {
        var lookup = FS.lookupPath(path);
        node = lookup.node;
        stat = FS.stat(path);
      } catch (e) {
        return callback(e);
      }

      if (FS.isDir(stat.mode)) {
        return callback(null, { 'timestamp': stat.mtime, 'mode': stat.mode });
      } else if (FS.isFile(stat.mode)) {
        // Performance consideration: storing a normal JavaScript array to a IndexedDB is much slower than storing a typed array.
        // Therefore always convert the file contents to a typed array first before writing the data to IndexedDB.
        node.contents = MEMFS.getFileDataAsTypedArray(node);
        return callback(null, { 'timestamp': stat.mtime, 'mode': stat.mode, 'contents': node.contents });
      } else {
        return callback(new Error('node type not supported'));
      }
    },
    storeLocalEntry: (path, entry, callback) => {
      try {
        if (FS.isDir(entry['mode'])) {
          FS.mkdirTree(path, entry['mode']);
        } else if (FS.isFile(entry['mode'])) {
          FS.writeFile(path, entry['contents'], { canOwn: true });
        } else {
          return callback(new Error('node type not supported'));
        }

        FS.chmod(path, entry['mode']);
        FS.utime(path, entry['timestamp'], entry['timestamp']);
      } catch (e) {
        return callback(e);
      }

      callback(null);
    },
    removeLocalEntry: (path, callback) => {
      try {
        var stat = FS.stat(path);

        if (FS.isDir(stat.mode)) {
          FS.rmdir(path);
        } else if (FS.isFile(stat.mode)) {
          FS.unlink(path);
        }
      } catch (e) {
        return callback(e);
      }

      callback(null);
    },
    loadRemoteEntry: (store, path, callback) => {
      var req = store.get(path);
      req.onsuccess = (event) => callback(null, event.target.result);
      req.onerror = (e) => {
        callback(e.target.error);
        e.preventDefault();
      };
    },
    storeRemoteEntry: (store, path, entry, callback) => {
      try {
        var req = store.put(entry, path);
      } catch (e) {
        callback(e);
        return;
      }
      req.onsuccess = (event) => callback();
      req.onerror = (e) => {
        callback(e.target.error);
        e.preventDefault();
      };
    },
    removeRemoteEntry: (store, path, callback) => {
      var req = store.delete(path);
      req.onsuccess = (event) => callback();
      req.onerror = (e) => {
        callback(e.target.error);
        e.preventDefault();
      };
    },
    reconcile: (src, dst, callback) => {
      var total = 0;

      var create = [];
      Object.keys(src.entries).forEach(function (key) {
        var e = src.entries[key];
        var e2 = dst.entries[key];
        if (!e2 || e['timestamp'].getTime() != e2['timestamp'].getTime()) {
          create.push(key);
          total++;
        }
      });

      var remove = [];
      Object.keys(dst.entries).forEach(function (key) {
        if (!src.entries[key]) {
          remove.push(key);
          total++;
        }
      });

      if (!total) {
        return callback(null);
      }

      var errored = false;
      var db = src.type === 'remote' ? src.db : dst.db;
      var transaction = db.transaction([PGFS.DB_STORE_NAME], 'readwrite');
      var store = transaction.objectStore(PGFS.DB_STORE_NAME);

      function done(err) {
        if (err && !errored) {
          errored = true;
          return callback(err);
        }
      };

      // transaction may abort if (for example) there is a QuotaExceededError
      transaction.onerror = transaction.onabort = (e) => {
        done(e.target.error);
        e.preventDefault();
      };

      transaction.oncomplete = (e) => {
        if (!errored) {
          callback(null);
        }
      };

      // sort paths in ascending order so directory entries are created
      // before the files inside them
      create.sort().forEach((path) => {
        if (dst.type === 'local') {
          PGFS.loadRemoteEntry(store, path, (err, entry) => {
            if (err) return done(err);
            PGFS.storeLocalEntry(path, entry, done);
          });
        } else {
          PGFS.loadLocalEntry(path, (err, entry) => {
            if (err) return done(err);
            PGFS.storeRemoteEntry(store, path, entry, done);
          });
        }
      });

      // sort paths in descending order so files are deleted before their
      // parent directories
      remove.sort().reverse().forEach((path) => {
        if (dst.type === 'local') {
          PGFS.removeLocalEntry(path, done);
        } else {
          PGFS.removeRemoteEntry(store, path, done);
        }
      });
    }
  }
});

if (WASMFS) {
  error("using -lpgfs is not currently supported in WasmFS.");
}


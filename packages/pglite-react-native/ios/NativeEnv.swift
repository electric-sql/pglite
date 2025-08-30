import Foundation

public class NativeEnv {
    public static func applyEnv(runtimeDir: String?, dataDir: String?, pgdata: String?) {
        if let runtimeDir = runtimeDir, !runtimeDir.isEmpty {
            setenv("IOS_RUNTIME_DIR", runtimeDir, 1)
            setenv("PGSYSCONFDIR", runtimeDir, 1)
            setenv("PGROOT", runtimeDir, 1)
        }
        
        if let dataDir = dataDir, !dataDir.isEmpty {
            setenv("IOS_DATA_DIR", dataDir, 1)
        }
        
        if let pgdata = pgdata, !pgdata.isEmpty {
            setenv("PGDATA", pgdata, 1)
        }
        
        // Provide a sane default user if none set upstream
        if getenv("PGUSER") == nil {
            setenv("PGUSER", "postgres", 0)
        }
    }
}
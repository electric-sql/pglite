#include "postgres.h"

#include <stdio.h> // FILE+fprintf
#include <string.h> // strlen
extern FILE* IDB_PIPE_FP;
extern FILE* SOCKET_FILE;
extern int SOCKET_DATA;
extern int IDB_STAGE;

static inline int
ends_with(const char *str, const char *suffix)
{
    if (!str || !suffix)
        return 0;
    size_t lenstr = strlen(str);
    size_t lensuffix = strlen(suffix);
    if (lensuffix >  lenstr)
        return 0;
    return strncmp(str + lenstr - lensuffix, suffix, lensuffix) == 0;
}

EMSCRIPTEN_KEEPALIVE FILE *
pg_popen(const char *command, const char *type) {
    if ( ends_with(command,"-V") || (IDB_STAGE>1)) {
    	fprintf(stderr,"# emsdk-popen[%s] STUB\n", command);
    	return stderr;
    }

    if (!IDB_STAGE) {
        fprintf(stderr,"# emsdk-popen[%s] (BOOT)\n", command);
        IDB_PIPE_FP = fopen( IDB_PIPE_BOOT, "w");
        IDB_STAGE = 1;
    } else {
        fprintf(stderr,"# emsdk-popen[%s] (SINGLE)\n", command);
        IDB_PIPE_FP = fopen( IDB_PIPE_SINGLE, "w");
        IDB_STAGE = 2;
    }

    return IDB_PIPE_FP;
}

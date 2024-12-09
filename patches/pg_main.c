#include PG_DEBUG_HEADER

#define IDB_OK  0b11111110
#define IDB_FAILED  0b0001
#define IDB_CALLED  0b0010
#define IDB_HASDB   0b0100
#define IDB_HASUSER 0b1000

#if defined(PG_MAIN) && ( defined(PG_EC_STATIC) || defined(__wasi__) )
#   warning "PG_EC_STATIC"

EMSCRIPTEN_KEEPALIVE void
fsync_pgdata(const char *pg_data, int serverVersion) {
    // stub
}

EMSCRIPTEN_KEEPALIVE void
get_restricted_token(void) {
    // stub
}

EMSCRIPTEN_KEEPALIVE void *
pg_malloc(size_t size)
{
	return malloc(size);
}
EMSCRIPTEN_KEEPALIVE void *
pg_malloc_extended(size_t size, int flags) {
    return malloc(size);
}

EMSCRIPTEN_KEEPALIVE void *
pg_realloc(void *ptr, size_t size) {
    return realloc(ptr, size);
}

EMSCRIPTEN_KEEPALIVE char *
pg_strdup(const char *in) {
	char	   *tmp;

	if (!in)
	{
		fprintf(stderr,
				_("cannot duplicate null pointer (internal error)\n"));
		exit(EXIT_FAILURE);
	}
	tmp = strdup(in);
	if (!tmp)
	{
		fprintf(stderr, _("out of memory\n"));
		exit(EXIT_FAILURE);
	}
	return tmp;
}

EMSCRIPTEN_KEEPALIVE char *
simple_prompt(const char *prompt, bool echo) {
    return pg_strdup("");
}

#endif // PG_EC_STATIC


#if defined(__EMSCRIPTEN__)
#   include "pg_main_emsdk.c"
#else
#   include "pg_main_wasi.c"
#endif


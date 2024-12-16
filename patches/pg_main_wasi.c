#if defined(PG_MAIN)
bool is_embed = true;
bool is_repl = true;
bool quote_all_identifiers = false;

__attribute__((export_name("interactive_one"))) void interactive_one(void);
__attribute__((export_name("interactive_file"))) void interactive_file(void);

/* exported from postmaster.h */
const char *
progname;

void
PostgresMain(const char *dbname, const char *username)
{
    puts("# 16: ERROR: PostgresMain should not be called anymore" __FILE__ );
    while (1){};
}



volatile bool send_ready_for_query = true;
volatile bool idle_in_transaction_timeout_enabled = false;
volatile bool idle_session_timeout_enabled = false;
volatile sigjmp_buf local_sigjmp_buf;

volatile bool repl = true ;
volatile int pg_idb_status = 0;
volatile bool inloop = false;

FILE * single_mode_feed = NULL;

bool force_echo = false;

extern void ReInitPostgres(const char *in_dbname, Oid dboid,
			 const char *username, Oid useroid,
			 bool load_session_libraries,
			 bool override_allow_connections,
			 char *out_dbname);


void
AsyncPostgresSingleUserMain(int argc, char *argv[],
					   const char *username, int async_restart)
{
	const char *dbname = NULL;
PDEBUG("# 47");
	/* Initialize startup process environment. */
	InitStandaloneProcess(argv[0]);

	/* Set default values for command-line options.	 */
	InitializeGUCOptions();
PDEBUG("# 53");
	/* Parse command-line options. */
	process_postgres_switches(argc, argv, PGC_POSTMASTER, &dbname);
PDEBUG("# 56");
	/* Must have gotten a database name, or have a default (the username) */
	if (dbname == NULL)
	{
		dbname = username;
		if (dbname == NULL)
			ereport(FATAL,
					(errcode(ERRCODE_INVALID_PARAMETER_VALUE),
					 errmsg("%s: no database nor user name specified",
							progname)));
	}

if (async_restart) goto async_db_change;
	/* Acquire configuration parameters */
	if (!SelectConfigFiles(userDoption, progname))
		proc_exit(1);

	checkDataDir();
	ChangeToDataDir();

	/*
	 * Create lockfile for data directory.
	 */
	CreateDataDirLockFile(false);

	/* read control file (error checking and contains config ) */
	LocalProcessControlFile(false);

	/*
	 * process any libraries that should be preloaded at postmaster start
	 */
	process_shared_preload_libraries();

	/* Initialize MaxBackends */
	InitializeMaxBackends();
PDEBUG("# 91");
	/*
	 * Give preloaded libraries a chance to request additional shared memory.
	 */
	process_shmem_requests();

	/*
	 * Now that loadable modules have had their chance to request additional
	 * shared memory, determine the value of any runtime-computed GUCs that
	 * depend on the amount of shared memory required.
	 */
	InitializeShmemGUCs();

	/*
	 * Now that modules have been loaded, we can process any custom resource
	 * managers specified in the wal_consistency_checking GUC.
	 */
	InitializeWalConsistencyChecking();

	CreateSharedMemoryAndSemaphores();

	/*
	 * Remember stand-alone backend startup time,roughly at the same point
	 * during startup that postmaster does so.
	 */
	PgStartTime = GetCurrentTimestamp();

	/*
	 * Create a per-backend PGPROC struct in shared memory. We must do this
	 * before we can use LWLocks.
	 */
	InitProcess();

// main
	SetProcessingMode(InitProcessing);

	/* Early initialization */
	BaseInit();
async_db_change:;
PDEBUG("# 130");
	/*
	 * General initialization.
	 *
	 * NOTE: if you are tempted to add code in this vicinity, consider putting
	 * it inside InitPostgres() instead.  In particular, anything that
	 * involves database access should be there, not here.
	 */
	InitPostgres(dbname, InvalidOid,	/* database to connect to */
				 username, InvalidOid,	/* role to connect as */
				 !am_walsender, /* honor session_preload_libraries? */
				 false,			/* don't ignore datallowconn */
				 NULL);			/* no out_dbname */

	/*
	 * If the PostmasterContext is still around, recycle the space; we don't
	 * need it anymore after InitPostgres completes.  Note this does not trash
	 * *MyProcPort, because ConnCreate() allocated that space with malloc()
	 * ... else we'd need to copy the Port data first.  Also, subsidiary data
	 * such as the username isn't lost either; see ProcessStartupPacket().
	 */
	if (PostmasterContext)
	{
		MemoryContextDelete(PostmasterContext);
		PostmasterContext = NULL;
	}

	SetProcessingMode(NormalProcessing);

	/*
	 * Now all GUC states are fully set up.  Report them to client if
	 * appropriate.
	 */
	BeginReportingGUCOptions();

	/*
	 * Also set up handler to log session end; we have to wait till now to be
	 * sure Log_disconnections has its final value.
	 */
	if (IsUnderPostmaster && Log_disconnections)
		on_proc_exit(log_disconnections, 0);

	pgstat_report_connect(MyDatabaseId);

	/* Perform initialization specific to a WAL sender process. */
	if (am_walsender)
		InitWalSender();

	/*
	 * Send this backend's cancellation info to the frontend.
	 */
	if (whereToSendOutput == DestRemote)
	{
		StringInfoData buf;

		pq_beginmessage(&buf, 'K');
		pq_sendint32(&buf, (int32) MyProcPid);
		pq_sendint32(&buf, (int32) MyCancelKey);
		pq_endmessage(&buf);
		/* Need not flush since ReadyForQuery will do it. */
	}

	/* Welcome banner for standalone case */
	if (whereToSendOutput == DestDebug)
		printf("\nPostgreSQL stand-alone backend %s\n", PG_VERSION);

	/*
	 * Create the memory context we will use in the main loop.
	 *
	 * MessageContext is reset once per iteration of the main loop, ie, upon
	 * completion of processing of each command message from the client.
	 */
	MessageContext = AllocSetContextCreate(TopMemoryContext, "MessageContext", ALLOCSET_DEFAULT_SIZES);

	/*
	 * Create memory context and buffer used for RowDescription messages. As
	 * SendRowDescriptionMessage(), via exec_describe_statement_message(), is
	 * frequently executed for ever single statement, we don't want to
	 * allocate a separate buffer every time.
	 */
	row_description_context = AllocSetContextCreate(TopMemoryContext, "RowDescriptionContext", ALLOCSET_DEFAULT_SIZES);
	MemoryContextSwitchTo(row_description_context);
	initStringInfo(&row_description_buf);
	MemoryContextSwitchTo(TopMemoryContext);
}

void
RePostgresSingleUserMain(int single_argc, char *single_argv[], const char *username)
{
#if PGDEBUG
printf("# 295: RePostgresSingleUserMain progname=%s for %s feed=%s\n", progname, single_argv[0], IDB_PIPE_SINGLE);
#endif
    single_mode_feed = fopen(IDB_PIPE_SINGLE, "r");

    // should be template1.
    const char *dbname = NULL;


    /* Parse command-line options. */
    process_postgres_switches(single_argc, single_argv, PGC_POSTMASTER, &dbname);
#if PGDEBUG
printf("# 306: dbname=%s\n", dbname);
#endif
    LocalProcessControlFile(false);

    process_shared_preload_libraries();

//	                InitializeMaxBackends();

// ? IgnoreSystemIndexes = true;
IgnoreSystemIndexes = false;
    process_shmem_requests();

    InitializeShmemGUCs();

    InitializeWalConsistencyChecking();

    PgStartTime = GetCurrentTimestamp();

    SetProcessingMode(InitProcessing);
PDEBUG("# 326: Re-InitPostgres");
if (am_walsender)
    PDEBUG("# 327: am_walsender == true");
//      BaseInit();

    InitPostgres(dbname, InvalidOid,	/* database to connect to */
                 username, InvalidOid,	/* role to connect as */
                 !am_walsender, /* honor session_preload_libraries? */
                 false,			/* don't ignore datallowconn */
                 NULL);			/* no out_dbname */

PDEBUG("# 334");
/*
    if (PostmasterContext)
    {
        PDEBUG("# 103");
        MemoryContextDelete(PostmasterContext);
        PostmasterContext = NULL;
    }
*/
    SetProcessingMode(NormalProcessing);

    BeginReportingGUCOptions();

    if (IsUnderPostmaster && Log_disconnections)
        on_proc_exit(log_disconnections, 0);

    pgstat_report_connect(MyDatabaseId);

    /* Perform initialization specific to a WAL sender process. */
    if (am_walsender)
        InitWalSender();
/*
    if (whereToSendOutput == DestRemote)
    {
        StringInfoData buf;

        pq_beginmessage(&buf, 'K');
        pq_sendint32(&buf, (int32) MyProcPid);
        pq_sendint32(&buf, (int32) MyCancelKey);
        pq_endmessage(&buf);
        // Need not flush since ReadyForQuery will do it.
    }
*/
#if PGDEBUG
    whereToSendOutput = DestDebug;
#endif

    if (whereToSendOutput == DestDebug)
        printf("\nPostgreSQL stand-alone backend %s\n", PG_VERSION);

    /*
     * Create the memory context we will use in the main loop.
     *
     * MessageContext is reset once per iteration of the main loop, ie, upon
     * completion of processing of each command message from the client.
     */
    MessageContext = AllocSetContextCreate(TopMemoryContext,
						                   "MessageContext",
						                   ALLOCSET_DEFAULT_SIZES);

    /*
     * Create memory context and buffer used for RowDescription messages. As
     * SendRowDescriptionMessage(), via exec_describe_statement_message(), is
     * frequently executed for ever single statement, we don't want to
     * allocate a separate buffer every time.
     */
    row_description_context = AllocSetContextCreate(TopMemoryContext,
									                "RowDescriptionContext",
									                ALLOCSET_DEFAULT_SIZES);
    MemoryContextSwitchTo(row_description_context);
    initStringInfo(&row_description_buf);
    MemoryContextSwitchTo(TopMemoryContext);

#if defined(__wasi__) //PGDEBUG
    puts("# 400: sjlj exception handler off");
#else
    if (sigsetjmp(local_sigjmp_buf, 1) != 0)
    {
        /*
         * NOTE: if you are tempted to add more code in this if-block,
         * consider the high probability that it should be in
         * AbortTransaction() instead.  The only stuff done directly here
         * should be stuff that is guaranteed to apply *only* for outer-level
         * error recovery, such as adjusting the FE/BE protocol status.
         */

        /* Since not using PG_TRY, must reset error stack by hand */
        error_context_stack = NULL;

        /* Prevent interrupts while cleaning up */
        HOLD_INTERRUPTS();

        /*
         * Forget any pending QueryCancel request, since we're returning to
         * the idle loop anyway, and cancel any active timeout requests.  (In
         * future we might want to allow some timeout requests to survive, but
         * at minimum it'd be necessary to do reschedule_timeouts(), in case
         * we got here because of a query cancel interrupting the SIGALRM
         * interrupt handler.)	Note in particular that we must clear the
         * statement and lock timeout indicators, to prevent any future plain
         * query cancels from being misreported as timeouts in case we're
         * forgetting a timeout cancel.
         */
        disable_all_timeouts(false);	/* do first to avoid race condition */
        QueryCancelPending = false;
        idle_in_transaction_timeout_enabled = false;
        idle_session_timeout_enabled = false;

        /* Not reading from the client anymore. */
        DoingCommandRead = false;

        /* Make sure libpq is in a good state */
        pq_comm_reset();

        /* Report the error to the client and/or server log */
        EmitErrorReport();

        /*
         * If Valgrind noticed something during the erroneous query, print the
         * query string, assuming we have one.
         */
        valgrind_report_error_query(debug_query_string);

        /*
         * Make sure debug_query_string gets reset before we possibly clobber
         * the storage it points at.
         */
        debug_query_string = NULL;

        /*
         * Abort the current transaction in order to recover.
         */
        AbortCurrentTransaction();

        if (am_walsender)
            WalSndErrorCleanup();

        PortalErrorCleanup();

        /*
         * We can't release replication slots inside AbortTransaction() as we
         * need to be able to start and abort transactions while having a slot
         * acquired. But we never need to hold them across top level errors,
         * so releasing here is fine. There also is a before_shmem_exit()
         * callback ensuring correct cleanup on FATAL errors.
         */
        if (MyReplicationSlot != NULL)
            ReplicationSlotRelease();

        /* We also want to cleanup temporary slots on error. */
        ReplicationSlotCleanup();

        jit_reset_after_error();

        /*
         * Now return to normal top-level context and clear ErrorContext for
         * next time.
         */
        MemoryContextSwitchTo(TopMemoryContext);
        FlushErrorState();

        /*
         * If we were handling an extended-query-protocol message, initiate
         * skip till next Sync.  This also causes us not to issue
         * ReadyForQuery (until we get Sync).
         */
        if (doing_extended_query_message)
            ignore_till_sync = true;

        /* We don't have a transaction command open anymore */
        xact_started = false;

        /*
         * If an error occurred while we were reading a message from the
         * client, we have potentially lost track of where the previous
         * message ends and the next one begins.  Even though we have
         * otherwise recovered from the error, we cannot safely read any more
         * messages from the client, so there isn't much we can do with the
         * connection anymore.
         */
        if (pq_is_reading_msg())
            ereport(FATAL,
	                (errcode(ERRCODE_PROTOCOL_VIOLATION),
	                 errmsg("terminating connection because protocol synchronization was lost")));

        /* Now we can allow interrupts again */
        RESUME_INTERRUPTS();
    }

    /* We can now handle ereport(ERROR) */
    PG_exception_stack = &local_sigjmp_buf;

#endif

    if (!ignore_till_sync)
        send_ready_for_query = true;	/* initially, or after error */

    if (!inloop) {
        inloop = true;
        PDEBUG("# 545: REPL(initdb-single):Begin " __FILE__ );

        while (repl) { interactive_file(); }
    } else {
        // signal error
        optind = -1;
    }

    fclose(single_mode_feed);

    if (strlen(getenv("REPL")) && getenv("REPL")[0]=='Y') {
        PDEBUG("# 556: REPL(initdb-single):End " __FILE__ );

        /* now use stdin as source */
        repl = true;
        single_mode_feed = NULL;

        force_echo = true;

        if (is_embed) {
#if PGDEBUG
            fprintf(stdout,"# 551: now in webloop(RAF)\npg> %c\n", 4);
#endif
            emscripten_set_main_loop( (em_callback_func)interactive_one, 0, 0);
        } else {

            PDEBUG("# 556: REPL(single after initdb):Begin(NORETURN)");
            while (repl) { interactive_file(); }
            PDEBUG("# 558: REPL:End Raising a 'RuntimeError Exception' to halt program NOW");
            {
                void (*npe)() = NULL;
                npe();
            }
        }

        // unreachable.
    }

    PDEBUG("# 582: no line-repl requested, exiting and keeping runtime alive");
}




/* ================================================================================ */
/* ================================================================================ */
/* ================================================================================ */
/* ================================================================================ */


extern int cma_rsize;


EMSCRIPTEN_KEEPALIVE void
pg_shutdown() {
    PDEBUG("# 637: pg_shutdown");
    proc_exit(66);
}

int loops = 0;

EMSCRIPTEN_KEEPALIVE void
interactive_file() {
	int			firstchar;
	int			c;				/* character read from getc() */
	StringInfoData input_message;
	StringInfoData *inBuf;
    FILE *stream ;

	/*
	 * At top of loop, reset extended-query-message flag, so that any
	 * errors encountered in "idle" state don't provoke skip.
	 */
	doing_extended_query_message = false;

	/*
	 * Release storage left over from prior query cycle, and create a new
	 * query input buffer in the cleared MessageContext.
	 */
	MemoryContextSwitchTo(MessageContext);
	MemoryContextResetAndDeleteChildren(MessageContext);

	initStringInfo(&input_message);
    inBuf = &input_message;
	DoingCommandRead = true;

	//firstchar = ReadCommand(&input_message);
	if (whereToSendOutput == DestRemote)
		firstchar = SocketBackend(&input_message);
	else {

	    /*
	     * display a prompt and obtain input from the user
	     */
        if (!single_mode_feed) {
	        printf("pg> %c\n", 4);
        	fflush(stdout);
            stream = stdin;
        } else {
            stream = single_mode_feed;
        }

	    resetStringInfo(inBuf);
	    while ((c = getc(stream)) != EOF)
	    {
		    if (c == '\n')
		    {
			    if (UseSemiNewlineNewline)
			    {
				    /*
				     * In -j mode, semicolon followed by two newlines ends the
				     * command; otherwise treat newline as regular character.
				     */
				    if (inBuf->len > 1 &&
					    inBuf->data[inBuf->len - 1] == '\n' &&
					    inBuf->data[inBuf->len - 2] == ';')
				    {
					    /* might as well drop the second newline */
					    break;
				    }
			    }
			    else
			    {
				    /*
				     * In plain mode, newline ends the command unless preceded by
				     * backslash.
				     */
				    if (inBuf->len > 0 &&
					    inBuf->data[inBuf->len - 1] == '\\')
				    {
					    /* discard backslash from inBuf */
					    inBuf->data[--inBuf->len] = '\0';
					    /* discard newline too */
					    continue;
				    }
				    else
				    {
					    /* keep the newline character, but end the command */
					    appendStringInfoChar(inBuf, '\n');
					    break;
				    }
			    }
		    }

		    /* Not newline, or newline treated as regular character */
		    appendStringInfoChar(inBuf, (char) c);
	    }

	    if (c == EOF && inBuf->len == 0) {
		    firstchar = EOF;
        } else {
        	/* Add '\0' to make it look the same as message case. */
	        appendStringInfoChar(inBuf, (char) '\0');
        	firstchar = 'Q';
        }

    }

	if (ignore_till_sync && firstchar != EOF)
		return;

    #include "pg_proto.c"
}

#include "./interactive_one_wasi.c"

void
PostgresSingleUserMain(int argc, char *argv[], const char *username) {
    while(1){};
}

#else  // defined(PG_MAIN)

extern bool is_embed;
extern bool is_repl;

extern bool quote_all_identifiers;

#if defined(__EMSCRIPTEN__) || defined(__wasi__)
#include <unistd.h>        /* chdir */
#include <sys/stat.h>      /* mkdir */
static
void mkdirp(const char *p) {
	if (!mkdir(p, 0700)) {
		fprintf(stderr, "# no '%s' directory, creating one ...\n", p);
	}
}
#endif /* wasm */


extern int pg_initdb_main(void);

extern void RePostgresSingleUserMain(int single_argc, char *single_argv[], const char *username);
extern void AsyncPostgresSingleUserMain(int single_argc, char *single_argv[], const char *username, int async_restart);
extern void main_post(void);
extern void proc_exit(int code);
extern bool IsPostmasterEnvironment;

extern volatile int pg_idb_status;


#if PGDEBUG
void print_bits(size_t const size, void const * const ptr);
void print_bits(size_t const size, void const * const ptr)
{
    unsigned char *b = (unsigned char*) ptr;
    unsigned char byte;
    int i, j;

    for (i = size-1; i >= 0; i--) {
        for (j = 7; j >= 0; j--) {
            byte = (b[i] >> j) & 1;
            printf("%u", byte);
        }
    }
    puts("");
}
#endif // PGDEBUG


EMSCRIPTEN_KEEPALIVE int
pg_initdb() {
    PDEBUG("# 1066: pg_initdb()");
    optind = 1;
    int async_restart = 1;
    pg_idb_status |= IDB_FAILED;

    if (!chdir(getenv("PGDATA"))){
        if (access("PG_VERSION", F_OK) == 0) {
        	chdir("/");

/* TODO: fill in empty dirs from db template
    if (mkdir(PGDB, 0700)) {

        // download a db case ?
    	mkdirp(PGDB);

        // db fixup because empty dirs may not packaged (eg git)

	    // mkdirp(WASM_PREFIX "/lib");
	    // mkdirp(WASM_PREFIX "/lib/postgresql");

	    mkdirp(PGDB "/pg_wal");
	    mkdirp(PGDB "/pg_wal/archive_status");
	    mkdirp(PGDB "/pg_wal/summaries");

	    mkdirp(PGDB "/pg_tblspc");
	    mkdirp(PGDB "/pg_snapshots");
	    mkdirp(PGDB "/pg_commit_ts");
	    mkdirp(PGDB "/pg_notify");
	    mkdirp(PGDB "/pg_replslot");
	    mkdirp(PGDB "/pg_twophase");


	    mkdirp(PGDB "/pg_logical");
	    mkdirp(PGDB "/pg_logical/snapshots");
	    mkdirp(PGDB "/pg_logical/mappings");
    } else {
        // no db : run initdb now.

    }


*/


            pg_idb_status |= IDB_HASDB;

            /* assume auth success for now */
            pg_idb_status |= IDB_HASUSER;
#if PGDEBUG
            printf("# 1080: pg_initdb: db exists at : %s TODO: test for db name : %s \n", getenv("PGDATA"), getenv("PGDATABASE"));
            print_bits(sizeof(pg_idb_status), &pg_idb_status);
#endif // PGDEBUG
            main_post();
            async_restart = 0;
            {
                char *single_argv[] = {
                    WASM_PREFIX "/bin/postgres",
                    "--single",
                    "-d", "1", "-B", "16", "-S", "512", "-f", "siobtnmh",
                    "-D", getenv("PGDATA"),
                    "-F", "-O", "-j",
                    WASM_PGOPTS,
                    getenv("PGDATABASE"),
                    NULL
                };
                int single_argc = sizeof(single_argv) / sizeof(char*) - 1;
                optind = 1;
                AsyncPostgresSingleUserMain(single_argc, single_argv, strdup(getenv("PGUSER")), async_restart);
            }

            goto initdb_done;
        }
    	chdir("/");
#if PGDEBUG
        printf("pg_initdb: no db found at : %s\n", getenv("PGDATA") );
#endif // PGDEBUG
    }
#if PGDEBUG
    PDEBUG("# 1080");
    printf("# pg_initdb_main result = %d\n", pg_initdb_main() );
#else
    pg_initdb_main();
#endif // PGDEBUG

    /* save stdin and use previous initdb output to feed boot mode */
    int saved_stdin = dup(STDIN_FILENO);
    {
        PDEBUG("# 1118: restarting in boot mode for initdb");
        freopen(IDB_PIPE_BOOT, "r", stdin);

        char *boot_argv[] = {
            WASM_PREFIX "/bin/postgres",
            "--boot",
            "-D", getenv("PGDATA"),
            "-d","3",
            WASM_PGOPTS,
            "-X", "1048576",
            NULL
        };
        int boot_argc = sizeof(boot_argv) / sizeof(char*) - 1;

	    set_pglocale_pgservice(boot_argv[0], PG_TEXTDOMAIN("initdb"));

        optind = 1;
        BootstrapModeMain(boot_argc, boot_argv, false);
        fclose(stdin);
#if PGDEBUG
        puts("# 886: keep " IDB_PIPE_BOOT );
#else
        remove(IDB_PIPE_BOOT);
#endif
        stdin = fdopen(saved_stdin, "r");
        /* fake a shutdown to comlplete WAL/OID states */
        proc_exit(66);
    }

    /* use previous initdb output to feed single mode */


    /* or resume a previous db */
    //IsPostmasterEnvironment = true;
    if (ShmemVariableCache->nextOid < ((Oid) FirstNormalObjectId)) {
#if PGDEBUG
        puts("# 891: warning oid base too low, will need to set OID range after initdb(bootstrap/single)");
#endif
    }

    {
        PDEBUG("# 889: restarting in single mode for initdb");

        char *single_argv[] = {
            WASM_PREFIX "/bin/postgres",
            "--single",
            "-d", "1", "-B", "16", "-S", "512", "-f", "siobtnmh",
            "-D", getenv("PGDATA"),
            "-F", "-O", "-j",
            WASM_PGOPTS,
            "template1",
            NULL
        };
        int single_argc = sizeof(single_argv) / sizeof(char*) - 1;
        optind = 1;
        RePostgresSingleUserMain(single_argc, single_argv, strdup( getenv("PGUSER")));
    }

    pg_idb_status |= IDB_CALLED;
    puts("        @@@@@@@@@@@@@@@@@@@@@ write version @@@@@@@@@@@@@@@@@@@@@@@@ ");

initdb_done:;
    IsPostmasterEnvironment = true;
    if (ShmemVariableCache->nextOid < ((Oid) FirstNormalObjectId)) {
        /* IsPostmasterEnvironment is now true
         these will be executed when required in varsup.c/GetNewObjectId
    	 ShmemVariableCache->nextOid = FirstNormalObjectId;
	     ShmemVariableCache->oidCount = 0;
        */
#if PGDEBUG
        puts("# 922: initdb done, oid base too low but OID range will be set because IsPostmasterEnvironment");
#endif
    }

    if (optind>0) {
        /* RESET getopt */
        optind = 1;
        /* we did not fail, clear the default failed state */
        pg_idb_status &= IDB_OK;
    } else {
        PDEBUG("# exiting on initdb-single error");
        // TODO raise js exception
    }
    return pg_idb_status;
}


#define PGDB WASM_PREFIX "/base"

EM_JS(int, is_web_env, (), {
    try {
        if (window) return 1;
    } catch(x) {return 0}
});


int g_argc;
char **g_argv;


void main_post() {
    /*
     * Fire up essential subsystems: error and memory management
     *
     * Code after this point is allowed to use elog/ereport, though
     * localization of messages may not work right away, and messages won't go
     * anywhere but stderr until GUC settings get loaded.
     */
    MemoryContextInit();

    /*
     * Set up locale information
     */
    set_pglocale_pgservice(g_argv[0], PG_TEXTDOMAIN("postgres"));

    /*
     * In the postmaster, absorb the environment values for LC_COLLATE and
     * LC_CTYPE.  Individual backends will change these later to settings
     * taken from pg_database, but the postmaster cannot do that.  If we leave
     * these set to "C" then message localization might not work well in the
     * postmaster.
     */
    init_locale("LC_COLLATE", LC_COLLATE, "");
    init_locale("LC_CTYPE", LC_CTYPE, "");

    /*
     * LC_MESSAGES will get set later during GUC option processing, but we set
     * it here to allow startup error messages to be localized.
     */
#ifdef LC_MESSAGES
    init_locale("LC_MESSAGES", LC_MESSAGES, "");
#endif

    /*
     * We keep these set to "C" always, except transiently in pg_locale.c; see
     * that file for explanations.
     */
    init_locale("LC_MONETARY", LC_MONETARY, "C");
    init_locale("LC_NUMERIC", LC_NUMERIC, "C");
    init_locale("LC_TIME", LC_TIME, "C");

    /*
     * Now that we have absorbed as much as we wish to from the locale
     * environment, remove any LC_ALL setting, so that the environment
     * variables installed by pg_perm_setlocale have force.
     */
    unsetenv("LC_ALL");
}

/*
EMSCRIPTEN_KEEPALIVE void
__cxa_throw(void *thrown_exception, void *tinfo, void *dest) {}
*/

extern void AsyncPostgresSingleUserMain(int single_argc, char *single_argv[], const char *username, int async_restart);


#if defined(__wasi__) || defined(__EMSCRIPTEN__)

#   define PG_INITDB_MAIN
#   define PG_MAIN

#if !defined(PG_LINKWEB)
#   define FRONTEND
#   include "../postgresql/src/common/logging.c"
#   undef FRONTEND
#endif

#   define icu_language_tag(loc_str) icu_language_tag_idb(loc_str)
#   define icu_validate_locale(loc_str) icu_validate_locale_idb(loc_str)

#if !defined(PG_LINKWEB)
#   include "../postgresql/src/interfaces/libpq/pqexpbuffer.c"
#endif
#   define fsync_pgdata(...)

#   include "../postgresql/src/bin/initdb/initdb.c"

    void use_socketfile(void) {
        is_repl = true;
        is_embed = false;
    }
#undef PG_INITDB_MAIN
#undef PG_MAIN

#endif // __wasi__



int exit_code = 0;

#if defined(EMUL_CMA)
extern char *cma_port ;
#endif

EMSCRIPTEN_KEEPALIVE void
setup() {
    PDEBUG("=setup=");

    // default for web is embed ( CMA )
PDEBUG(" >>>>>>>>>>>>> FORCING EMBED MODE <<<<<<<<<<<<<<<<");
    is_embed = true; // is_web_env();


/*
// and now for some undisclosed reason
// we may not use CMA https://github.com/llvm/llvm-project/blob/f78610af3feb88f0e1edb2482dc77490fb4cad77/lld/wasm/Driver.cpp#L767

// check https://github.com/llvm/llvm-project/issues?q=is%3Aissue+is%3Aopen+global-base+label%3Abackend%3AWebAssembly
#define IO ((char *)(0))
{
    for (int i=0;i<64;i++)
        if ( IO[i] )
            printf("%c", IO[i] );
        else
            printf(".");
    puts("");
}
*/



#if PGDEBUG
    printf("# 1095: argv0 (%s) PGUSER=%s PGDATA=%s PGDATABASE=%s PGEMBED=%s REPL=%s\n",
        g_argv[0], getenv("PGUSER"), getenv("PGDATA"),  getenv("PGDATABASE"), getenv("PGEMBED"), getenv("REPL") );
#endif

    int argc = g_argc;

    char key[256];
    int i=0;
// extra env is always after normal args
    PDEBUG("# ============= argv dump ==================");
    {
        for (;i<argc;i++) {
            const char *kv = g_argv[i];
            if (!strcmp(kv,"--")) {
                g_argc = i;
                goto extra_env;
            }
/*
            for (int sk=0;sk<strlen(kv);sk++)
                if(kv[sk]=='=') {
                    g_argc = i;
                    goto extra_env;
                }
*/
#if PGDEBUG
            printf("%s ", kv);
#endif
        }
    }
extra_env:;
    PDEBUG("\n# ============= arg->env dump ==================");
    {
        for (;i<argc;i++) {
            const char *kv = g_argv[i];
            for (int sk=0;sk<strlen(kv);sk++) {
                if (sk>255) {
                    puts("buffer overrun on extra env at:");
                    puts(kv);
                    continue;
                }
                if (kv[sk]=='=') {
                    memcpy(key, kv, sk);
                    key[sk] = 0;
#if PGDEBUG
                    printf("%s='%s'\n", &(key[0]), &(kv[sk+1]));
#endif
                    setenv(key, &kv[sk+1], 1);
                }
            }
        }
    }
    PDEBUG("\n# =========================================");

	g_argv[0] = strdup(WASM_PREFIX "/bin/postgres");
	progname = get_progname(g_argv[0]);

	chdir("/");
    mkdirp("/tmp");
    mkdirp(WASM_PREFIX);

	// postgres does not know where to find the server configuration file.
    // also we store the fake locale file there.
	// postgres.js:1605 You must specify the --config-file or -D invocation option or set the PGDATA environment variable.

    /* enforce ? */
	setenv("PGSYSCONFDIR", WASM_PREFIX, 1);
	setenv("PGCLIENTENCODING", "UTF8", 1);

    // default is to run a repl loop
    setenv("REPL", "Y", 0);
/*
 * we cannot run "locale -a" either from web or node. the file getenv("PGSYSCONFDIR") / "locale"
 * serves as popen output
 */

	setenv("LC_CTYPE", "C" , 1);

    /* defaults */

    setenv("TZ", "UTC", 0);
    setenv("PGTZ", "UTC", 0);
	setenv("PGUSER", WASM_USERNAME , 0);
	setenv("PGDATA", PGDB , 0);
	setenv("PGDATABASE", "template1" , 0);
    setenv("PG_COLOR", "always", 0);

    /*
    PGDATESTYLE
    TZ
    PG_SHMEM_ADDR

    PGCTLTIMEOUT
    PG_TEST_USE_UNIX_SOCKETS
    INITDB_TEMPLATE
    PSQL_HISTORY
    TMPDIR
    PGOPTIONS
    */

#if PGDEBUG
    puts("# ============= env dump ==================");
    for (char **env = environ; *env != 0; env++) {
        char *drefp = *env;
        printf("# %s\n", drefp);
    }
    puts("# =========================================");
#endif

#if PGDEBUG
    printf("# 1267: argv0 (%s) PGUSER=%s PGDATA=%s PGDATABASE=%s PGEMBED=%s REPL=%s\n",
        g_argv[0], getenv("PGUSER"), getenv("PGDATA"),  getenv("PGDATABASE"), getenv("PGEMBED"), getenv("REPL"));
#endif


    /*
     * Platform-specific startup hacks
     */
    startup_hacks(progname);

    /*
     * Remember the physical location of the initially given argv[] array for
     * possible use by ps display.  On some platforms, the argv[] storage must
     * be overwritten in order to set the process title for ps. In such cases
     * save_ps_display_args makes and returns a new copy of the argv[] array.
     *
     * save_ps_display_args may also move the environment strings to make
     * extra room. Therefore this should be done as early as possible during
     * startup, to avoid entanglements with code that might save a getenv()
     * result pointer.
     */
    g_argv = save_ps_display_args(g_argc, g_argv);

    if (getenv("REPL") && strlen(getenv("REPL")))
        is_repl = getenv("REPL")[0]=='Y';

    if (getenv("PGEMBED") && strlen(getenv("PGEMBED")))
        is_embed = getenv("PGEMBED")[0]=='Y';

    if (!is_repl) {
        PDEBUG("# 1360: exit with live runtime (norepl, (no)db)");
        exit_code = 0;
        return;
    }

    // repl required, run initdb now if needed.
    bool hadloop_error = false;

    whereToSendOutput = DestNone;

    if (is_embed) {
        puts("\n\n    setup: is_embed : not running initdb\n\n");
        return ;
    }

    int initdb_code = pg_initdb();

    hadloop_error = initdb_code & IDB_FAILED;

    if (!hadloop_error) {

        int async_restart = (pg_idb_status | IDB_CALLED) > 0;

        main_post();

        /*
         * Catch standard options before doing much else, in particular before we
         * insist on not being root.
         */
        if (g_argc > 1) {
	        if (strcmp(g_argv[1], "--help") == 0 || strcmp(g_argv[1], "-?") == 0)
	        {
		        help(progname);
		        exit(0);
	        }
	        if (strcmp(g_argv[1], "--version") == 0 || strcmp(g_argv[1], "-V") == 0)
	        {
		        fputs(PG_BACKEND_VERSIONSTR, stdout);
		        exit(0);
	        }

        }

        if (g_argc > 1 && strcmp(g_argv[1], "--check") == 0) {
	        BootstrapModeMain(g_argc, g_argv, true);
            exit_code = 0;
            return;
        }

        if (g_argc > 1 && strcmp(g_argv[1], "--boot") == 0) {
            PDEBUG("# 1410: boot: " __FILE__ );
            BootstrapModeMain(g_argc, g_argv, false);
            exit_code = 0;
            return;
        }

        PDEBUG("# 1415: single: " __FILE__ );
        if (async_restart)
            puts("restart from initdb");
        AsyncPostgresSingleUserMain(g_argc, g_argv, strdup(getenv("PGUSER")), async_restart);
    }

}

extern void interactive_one(void);

EMSCRIPTEN_KEEPALIVE void
loop() {
    PDEBUG("=loop=");
    // so it is repl
    if (!is_embed) {
        PDEBUG("# 1344: node repl");
        //pg_repl_raf();
    }
    //interactive_one();
}


EMSCRIPTEN_KEEPALIVE void
set_repl(int value) {
    if (value) {
        setenv("REPL","Y",1);
        is_repl = true;
    } else {
        setenv("REPL","N",1);
        is_repl = false;
    }
}

/*
char **copy_argv(int argc, char *argv[]) {
    // calculate the contiguous argv buffer size
    int length=0;
    size_t ptr_args = argc + 1;
    for (int i = 0; i < argc; i++) {
        length += (strlen(argv[i]) + 1);
    }
    char** new_argv = (char**)malloc((ptr_args) * sizeof(char*) + length);

    // copy argv into the contiguous buffer
    length = 0;
    for (int i = 0; i < argc; i++) {
        new_argv[i] = &(((char*)new_argv)[(ptr_args * sizeof(char*)) + length]);
        strcpy(new_argv[i], argv[i]);
        length += (strlen(argv[i]) + 1);
    }

    // insert NULL terminating ptr at the end of the ptr array
    new_argv[ptr_args-1] = NULL;
    return (new_argv);
}
*/

extern int cma_rsize;

#if defined(EMUL_CMA)
#error "EMUL_CMA"
char *cma_port;
EMSCRIPTEN_KEEPALIVE int
pg_getport() {
    // when using low mem, memory addr of index 0 would not be accessible.
    cma_port[1]=0;
    return (int)(&cma_port[0]);
}
#else
EMSCRIPTEN_KEEPALIVE int
pg_getport() {
    return 0;
}
#endif

int
main(int argc, char **argv) {
    #if defined(EMUL_CMA)
    cma_port = malloc(16384*1024);
    #endif
    g_argc =argc;
    g_argv =argv;
    setup();
    if (is_embed) {
        fprintf(stderr, "\n\n\n   @@@@@@@@@@@@@@@@@@@@@@@@@ EXITING with live runtime port %d @@@@@@@@@@@@@@@@\n\n\n", pg_getport());
        whereToSendOutput = DestNone;
        cma_rsize = 0;

    } else {
        loop();
        emscripten_force_exit(exit_code);
    }
	return exit_code;
}

#endif // PG_MAIN
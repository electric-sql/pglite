#include PG_DEBUG_HEADER

#define IDB_OK  0b11111110
#define IDB_FAILED  0b0001
#define IDB_CALLED  0b0010
#define IDB_HASDB   0b0100
#define IDB_HASUSER 0b1000

#if defined(PG_MAIN)

#if defined(PG_EC_STATIC)
#warning "PG_EC_STATIC"

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



#endif


bool is_node = false;
bool is_repl = true;

EMSCRIPTEN_KEEPALIVE bool
quote_all_identifiers = false;


EMSCRIPTEN_KEEPALIVE void interactive_one(void);
EMSCRIPTEN_KEEPALIVE void interactive_file(void);

/* exported from postmaster.h */
EMSCRIPTEN_KEEPALIVE const char*
progname;

void
PostgresMain(const char *dbname, const char *username)
{
    puts("# 82: ERROR: PostgresMain should not be called anymore" __FILE__ );
    while (1){};
}



volatile bool send_ready_for_query = true;
volatile bool idle_in_transaction_timeout_enabled = false;
volatile bool idle_session_timeout_enabled = false;
volatile sigjmp_buf local_sigjmp_buf;

volatile bool repl = true ;
volatile int pg_idb_status = 0;
volatile bool inloop = false;

/* ================================================================================ */
/* ================================================================================ */
/* ================================================================================ */
/* ================================================================================ */

EMSCRIPTEN_KEEPALIVE
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

	/* Initialize startup process environment. */
	InitStandaloneProcess(argv[0]);

	/* Set default values for command-line options.	 */
	InitializeGUCOptions();
PDEBUG("# 125");
	/* Parse command-line options. */
	process_postgres_switches(argc, argv, PGC_POSTMASTER, &dbname);
PDEBUG("# 128");
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
PDEBUG("# 163");
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
printf("# 291: RePostgresSingleUserMain progname=%s for %s\n", progname, single_argv[0]);
#endif
    single_mode_feed = fopen(IDB_PIPE_SINGLE, "r");

    // should be template1.
    const char *dbname = NULL;


    /* Parse command-line options. */
    process_postgres_switches(single_argc, single_argv, PGC_POSTMASTER, &dbname);
#if PGDEBUG
printf("# 301: dbname=%s\n", dbname);
#endif
    LocalProcessControlFile(false);

    process_shared_preload_libraries();

//	                InitializeMaxBackends();
PDEBUG("# 308 ?");

// ? IgnoreSystemIndexes = true;
IgnoreSystemIndexes = false;
    process_shmem_requests();

    InitializeShmemGUCs();

    InitializeWalConsistencyChecking();

    PgStartTime = GetCurrentTimestamp();

    SetProcessingMode(InitProcessing);
PDEBUG("# 321: Re-InitPostgres");
//      BaseInit();

    InitPostgres(dbname, InvalidOid,	/* database to connect to */
                 username, InvalidOid,	/* role to connect as */
                 !am_walsender, /* honor session_preload_libraries? */
                 false,			/* don't ignore datallowconn */
                 NULL);			/* no out_dbname */
/*
PDEBUG("# 330");
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

    /*
     * POSTGRES main processing loop begins here
     *
     * If an exception is encountered, processing resumes here so we abort the
     * current transaction and start a new one.
     *
     * You might wonder why this isn't coded as an infinite loop around a
     * PG_TRY construct.  The reason is that this is the bottom of the
     * exception stack, and so with PG_TRY there would be no exception handler
     * in force at all during the CATCH part.  By leaving the outermost setjmp
     * always active, we have at least some chance of recovering from an error
     * during error recovery.  (If we get into an infinite loop thereby, it
     * will soon be stopped by overflow of elog.c's internal state stack.)
     *
     * Note that we use sigsetjmp(..., 1), so that this function's signal mask
     * (to wit, UnBlockSig) will be restored when longjmp'ing to here.  This
     * is essential in case we longjmp'd out of a signal handler on a platform
     * where that leaves the signal blocked.  It's not redundant with the
     * unblock in AbortTransaction() because the latter is only called if we
     * were inside a transaction.
     */

#if 0 //PGDEBUG
    #warning "exception handler off"
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

    if (!ignore_till_sync)
        send_ready_for_query = true;	/* initially, or after error */

#endif

    if (!inloop) {
        inloop = true;
        PDEBUG("# 311: REPL(initdb-single):Begin " __FILE__ );

        while (repl) { interactive_file(); }
    } else {
        // signal error
        optind = -1;
    }

    fclose(single_mode_feed);

    if (strlen(getenv("REPL")) && getenv("REPL")[0]=='Y') {
        PDEBUG("# 551: REPL(initdb-single):End " __FILE__ );

        /* now use stdin as source */
        repl = true;
        single_mode_feed = NULL;

        force_echo = true;

        if (!is_node) {
#if PGDEBUG
            fprintf(stdout,"# 560: now in webloop(RAF)\npg> %c\n", 4);
#endif
            emscripten_set_main_loop( (em_callback_func)interactive_one, 0, 0);
        } else {
            PDEBUG("# 563: REPL(single after initdb):Begin(NORETURN)");
            while (repl) { interactive_file(); }
            PDEBUG("# 5685 REPL:End Raising a 'RuntimeError Exception' to halt program NOW");
            {
                void (*npe)() = NULL;
                npe();
            }
        }

        // unreachable.
    }

    PDEBUG("# 575: no line-repl requested, exiting and keeping runtime alive");
}




/* ================================================================================ */
/* ================================================================================ */
/* ================================================================================ */
/* ================================================================================ */


extern int cma_rsize;

EMSCRIPTEN_KEEPALIVE void
pg_repl_raf(){

    is_repl = strlen(getenv("REPL")) && getenv("REPL")[0]=='Y';
    if (is_node) {
        PDEBUG(WASM_PREFIX "/bin/postgres.js");
        printf("cma_rsize was %d\n now set to 0\n", cma_rsize);
        // force wire socket emulation
        cma_rsize = 0;
        if (!strcmp(getenv("_"), WASM_PREFIX "/bin/postgres.js")) {
            while (1) {
                interactive_one();
            }
            PDEBUG("# 1529 REPL:End Raising a 'RuntimeError Exception' to halt program NOW");
            {
                void (*npe)() = NULL;
                npe();
            }

        }
    }
    if (is_repl) {
PDEBUG("# 611: pg_repl_raf(REPL)");
        repl = true;
        single_mode_feed = NULL;
        force_echo = true;
        whereToSendOutput = DestNone;
        emscripten_set_main_loop( (em_callback_func)interactive_one, 0, 0);
    } else {
        PDEBUG("# 602: TODO: headless wire mode");
    }

    if (is_node) {
PDEBUG("# 622: pg_repl_raf(NODE) EXIT!!!");
    }

}


EMSCRIPTEN_KEEPALIVE void
pg_shutdown() {
    PDEBUG("pg_shutdown");
    proc_exit(66);
}

int loops = 0;



EM_JS(int, peek_fd, (int fd), {
    return test_data.length;
});

EM_JS(int, fnc_getfd, (int fd), {
    return fnc_stdin()
});


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

#include "./interactive_one.c"


void
PostgresSingleUserMain(int argc, char *argv[],
					   const char *username)
{
	const char *dbname = NULL;

	Assert(!IsUnderPostmaster);

	progname = get_progname(argv[0]);

	/* Initialize startup process environment. */
	InitStandaloneProcess(argv[0]);

	/* Set default values for command-line options.	 */
	InitializeGUCOptions();

	/* Parse command-line options. */
	process_postgres_switches(argc, argv, PGC_POSTMASTER, &dbname);

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
PDEBUG("784");
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

	/*
	 * POSTGRES main processing loop begins here
	 *
	 * If an exception is encountered, processing resumes here so we abort the
	 * current transaction and start a new one.
	 *
	 * You might wonder why this isn't coded as an infinite loop around a
	 * PG_TRY construct.  The reason is that this is the bottom of the
	 * exception stack, and so with PG_TRY there would be no exception handler
	 * in force at all during the CATCH part.  By leaving the outermost setjmp
	 * always active, we have at least some chance of recovering from an error
	 * during error recovery.  (If we get into an infinite loop thereby, it
	 * will soon be stopped by overflow of elog.c's internal state stack.)
	 *
	 * Note that we use sigsetjmp(..., 1), so that this function's signal mask
	 * (to wit, UnBlockSig) will be restored when longjmp'ing to here.  This
	 * is essential in case we longjmp'd out of a signal handler on a platform
	 * where that leaves the signal blocked.  It's not redundant with the
	 * unblock in AbortTransaction() because the latter is only called if we
	 * were inside a transaction.
	 */

exception_handler:

#if 0 // PGDEBUG
    #warning "exception handler off"
#else
	if (sigsetjmp(local_sigjmp_buf, 1) != 0)
	{
		error_context_stack = NULL;
		HOLD_INTERRUPTS();
		disable_all_timeouts(false);	/* do first to avoid race condition */
		QueryCancelPending = false;
		idle_in_transaction_timeout_enabled = false;
		idle_session_timeout_enabled = false;
		DoingCommandRead = false;
		pq_comm_reset();
		EmitErrorReport();
		valgrind_report_error_query(debug_query_string);
		debug_query_string = NULL;
		AbortCurrentTransaction();
		if (am_walsender)
			WalSndErrorCleanup();
		PortalErrorCleanup();
		if (MyReplicationSlot != NULL)
			ReplicationSlotRelease();
		ReplicationSlotCleanup();
		jit_reset_after_error();
		MemoryContextSwitchTo(TopMemoryContext);
		FlushErrorState();
		if (doing_extended_query_message)
			ignore_till_sync = true;
		xact_started = false;
		if (pq_is_reading_msg()) {
			ereport(FATAL,
					(errcode(ERRCODE_PROTOCOL_VIOLATION),
					 errmsg("terminating connection because protocol synchronization was lost")));
        }
		RESUME_INTERRUPTS();
	}
	PG_exception_stack = &local_sigjmp_buf;
	if (!ignore_till_sync)
		send_ready_for_query = true;	/* initially, or after error */
#endif

	/*
	 * Non-error queries loop here.
	 */

printf("# 943: hybrid loop:Begin CI=%s\n", getenv("CI") );
    fprintf(stdout,"pg> %c\n", 4);
	while (repl && !proc_exit_inprogress) {
        interactive_one();
	}
    PDEBUG("\n\n# 996: REPL:End " __FILE__);

    abort();
#if !defined(PG_INITDB_MAIN)
    proc_exit(0);
#endif
}

#else

extern bool is_node;
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


#if defined(PG_INITDB_MAIN)
extern int pg_initdb_main();

extern void RePostgresSingleUserMain(int single_argc, char *single_argv[], const char *username);
extern void AsyncPostgresSingleUserMain(int single_argc, char *single_argv[], const char *username, int async_restart);
extern void main_post();
extern void proc_exit(int code);

extern volatile int pg_idb_status;
#if PGDEBUG
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
#endif
EMSCRIPTEN_KEEPALIVE int
pg_initdb() {
    PDEBUG("# 1022: pg_initdb()");
    optind = 1;
    int async_restart = 1;
    pg_idb_status |= IDB_FAILED;

    if (!chdir(getenv("PGDATA"))){
        if (access("PG_VERSION", F_OK) == 0) {
        	chdir("/");

            pg_idb_status |= IDB_HASDB;

            /* assume auth success for now */
            pg_idb_status |= IDB_HASUSER;
#if PGDEBUG
            printf("# 1054: pg_initdb: db exists at : %s TODO: test for db name : %s \n", getenv("PGDATA"), getenv("PGDATABASE"));
            print_bits(sizeof(pg_idb_status), &pg_idb_status);
#endif
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
#endif
    }
#if PGDEBUG
    PDEBUG("# 1080");
    printf("# pg_initdb_main result = %d\n", pg_initdb_main() );
#endif

    /* save stdin and use previous initdb output to feed boot mode */
    int saved_stdin = dup(STDIN_FILENO);
    {
        PDEBUG("# 1087: restarting in boot mode for initdb");
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
        remove(IDB_PIPE_BOOT);
        stdin = fdopen(saved_stdin, "r");
        /* fake a shutdown to comlplete WAL/OID states */
        proc_exit(66);
    }

    /* use previous initdb output to feed single mode */


    /* or resume a previous db */


    {
        PDEBUG("# 1119: restarting in single mode for initdb");

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

initdb_done:;
    pg_idb_status |= IDB_CALLED;
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


#endif

#define PGDB WASM_PREFIX "/base"

EM_JS(int, is_web_env, (), {
    try {
        if (window) return 1;
    } catch(x) {return 0}
});

static void
main_pre(int argc, char *argv[]) {


    char key[256];
    int i=0;
// extra env is always after normal args
    PDEBUG("# ============= extra argv dump ==================");
    {
        for (;i<argc;i++) {
            const char *kv = argv[i];
            for (int sk=0;sk<strlen(kv);sk++)
                if(kv[sk]=='=')
                    goto extra_env;
#if PGDEBUG
            printf("%s ", kv);
#endif
        }
    }
extra_env:;
    PDEBUG("\n# ============= arg->env dump ==================");
    {
        for (;i<argc;i++) {
            const char *kv = argv[i];
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

	argv[0] = strdup(WASM_PREFIX "/bin/postgres");


#if defined(__EMSCRIPTEN__)
    EM_ASM({
        Module.is_worker = (typeof WorkerGlobalScope !== 'undefined') && self instanceof WorkerGlobalScope;
        Module.FD_BUFFER_MAX = $0;
        Module.emscripten_copy_to = console.warn;
    }, FD_BUFFER_MAX);  /* ( global mem start / num fd max ) */

    if (is_node) {
    	setenv("ENVIRONMENT", "node" , 1);
        EM_ASM({
#if PGDEBUG
            console.warn("prerun(C-node) worker=", Module.is_worker);
#endif
            Module['postMessage'] = function custom_postMessage(event) {
                console.log("# 1219: onCustomMessage:",__FILE__, event);
            };
        });

    } else {
    	setenv("ENVIRONMENT", "web" , 1);
#if PGDEBUG
        EM_ASM({
            console.warn("prerun(C-web) worker=", Module.is_worker);
        });
#endif
        is_repl = true;
    }

    EM_ASM({
        if (Module.is_worker) {
#if PGDEBUG
            console.log("Main: running in a worker, setting onCustomMessage");
#endif
            function onCustomMessage(event) {
                console.log("onCustomMessage:", event);
            };
            Module['onCustomMessage'] = onCustomMessage;
        } else {
#if PGDEBUG
            console.log("Running in main thread, faking onCustomMessage");
#endif
            Module['postMessage'] = function custom_postMessage(event) {
                switch (event.type) {
                    case "raw" :  {
                        stringToUTF8( event.data, shm_rawinput, Module.FD_BUFFER_MAX);
                        break;
                    }

                    case "stdin" :  {
                        stringToUTF8( event.data, 1, Module.FD_BUFFER_MAX);
                        break;
                    }
                    case "rcon" :  {
                        stringToUTF8( event.data, shm_rcon, Module.FD_BUFFER_MAX);
                        break;
                    }
                    default : console.warn("custom_postMessage?", event);
                }
            };
            //if (!window.vm)
              //  window.vm = Module;
        };
    });

#endif
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

#if PGDEBUG
    puts("# ============= env dump ==================");
    for (char **env = environ; *env != 0; env++) {
        char *drefp = *env;
        printf("# %s\n", drefp);
    }
    puts("# =========================================");
#endif
}

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

EMSCRIPTEN_KEEPALIVE void
__cxa_throw(void *thrown_exception, void *tinfo, void *dest) {}

extern void AsyncPostgresSingleUserMain(int single_argc, char *single_argv[], const char *username, int async_restart);

EMSCRIPTEN_KEEPALIVE int
main_repl(int async) {
    bool hadloop_error = false;

    whereToSendOutput = DestNone;

    if (!mkdir(PGDB, 0700)) {
        /* no db : run initdb now. */
#if PGDEBUG
        fprintf(stderr, "PGDATA=%s not found, running initdb with defaults\n", PGDB );
#endif
        #if defined(PG_INITDB_MAIN)
            #warning "web build"
            hadloop_error = pg_initdb() & IDB_FAILED;

        #else
            #warning "node build"
        #endif

    } else {
        // download a db case ?
    	mkdirp(PGDB);

        // db fixup because empty dirs are not packaged
	    /*
	    mkdirp(WASM_PREFIX "/lib");
	    mkdirp(WASM_PREFIX "/lib/postgresql");
	    */
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

    }

    if (!hadloop_error) {
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
            return 0;
        }

        if (g_argc > 1 && strcmp(g_argv[1], "--boot") == 0) {
            PDEBUG("# 1410: boot: " __FILE__ );
            BootstrapModeMain(g_argc, g_argv, false);
            return 0;
        }

        PDEBUG("# 1415: single: " __FILE__ );
        if (async>0)
            AsyncPostgresSingleUserMain(g_argc, g_argv, strdup(getenv("PGUSER")), 0);
        else
            PostgresSingleUserMain(g_argc, g_argv, strdup( getenv("PGUSER")));
    }
    return 0;
}

extern void pg_repl_raf(void);

int
main(int argc, char **argv)
{
    int ret=0;
    is_node = !is_web_env();

    main_pre(argc, argv);
#if PGDEBUG
    printf("# 1434 argv0 (%s) PGUSER=%s PGDATA=%s\n PGDATABASE=%s\n", argv[0], getenv("PGUSER"), getenv("PGDATA"),  getenv("PGDATABASE"));
#endif
	progname = get_progname(argv[0]);

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
    argv = save_ps_display_args(argc, argv);
    g_argv = argv;
    g_argc = argc;

    is_repl = strlen(getenv("REPL")) && getenv("REPL")[0]=='Y';
    if (!is_repl) {
        PDEBUG("# 1473: exit with live runtime (nodb)");
        return 0;
    }

    // so it is repl
    main_repl(1);
    if (is_node) {
        pg_repl_raf();
    }
    emscripten_force_exit(ret);
	return ret;
}

#endif // PG_MAIN

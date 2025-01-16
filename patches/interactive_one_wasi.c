#define PDEBUG(string) puts(string)
#include <unistd.h>  // access, unlink

#include "interactive_one.h"

static void pg_prompt() {
    fprintf(stdout,"pg> %c\n", 4);
}

extern void AbortTransaction(void);
extern void CleanupTransaction(void);
extern void ClientAuthentication(Port *port);
extern FILE* SOCKET_FILE;
extern int SOCKET_DATA;

/*
init sequence
___________________________________
SubPostmasterMain / (forkexec)
    InitPostmasterChild
    shm attach
    preload

    BackendInitialize(Port *port) -> collect initial packet

	    pq_init();
	    whereToSendOutput = DestRemote;
	    status = ProcessStartupPacket(port, false, false);
            pq_startmsgread
            pq_getbytes from pq_recvbuf
            TODO: place PqRecvBuffer (8K) in lower mem for zero copy

        PerformAuthentication
        ClientAuthentication(port)
        CheckPasswordAuth SYNC!!!!  ( sendAuthRequest flush -> recv_password_packet )
    InitShmemAccess/InitProcess/CreateSharedMemoryAndSemaphores

    BackendRun(port)
        PostgresMain


-> pq_flush() is synchronous


buffer sizes:

    https://github.com/postgres/postgres/blob/master/src/backend/libpq/pqcomm.c#L118

    https://github.com/postgres/postgres/blob/master/src/common/stringinfo.c#L28


*/

extern int	ProcessStartupPacket(Port *port, bool ssl_done, bool gss_done);
extern void pq_recvbuf_fill(FILE* fp, int packetlen);

#define PG_MAX_AUTH_TOKEN_LENGTH	65535
static char *
recv_password_packet(Port *port) {
	StringInfoData buf;
	int			mtype;

	pq_startmsgread();

	/* Expect 'p' message type */
	mtype = pq_getbyte();
	if (mtype != 'p')
	{
		/*
		 * If the client just disconnects without offering a password, don't
		 * make a log entry.  This is legal per protocol spec and in fact
		 * commonly done by psql, so complaining just clutters the log.
		 */
		if (mtype != EOF)
			ereport(ERROR,
					(errcode(ERRCODE_PROTOCOL_VIOLATION),
					 errmsg("expected password response, got message type %d",
							mtype)));
		return NULL;			/* EOF or bad message type */
	}

	initStringInfo(&buf);
	if (pq_getmessage(&buf, PG_MAX_AUTH_TOKEN_LENGTH))	/* receive password */
	{
		/* EOF - pq_getmessage already logged a suitable message */
		pfree(buf.data);
		return NULL;
	}

	/*
	 * Apply sanity check: password packet length should agree with length of
	 * contained string.  Note it is safe to use strlen here because
	 * StringInfo is guaranteed to have an appended '\0'.
	 */
	if (strlen(buf.data) + 1 != buf.len)
		ereport(ERROR,
				(errcode(ERRCODE_PROTOCOL_VIOLATION),
				 errmsg("invalid password packet size")));

	/*
	 * Don't allow an empty password. Libpq treats an empty password the same
	 * as no password at all, and won't even try to authenticate. But other
	 * clients might, so allowing it would be confusing.
	 *
	 * Note that this only catches an empty password sent by the client in
	 * plaintext. There's also a check in CREATE/ALTER USER that prevents an
	 * empty string from being stored as a user's password in the first place.
	 * We rely on that for MD5 and SCRAM authentication, but we still need
	 * this check here, to prevent an empty password from being used with
	 * authentication methods that check the password against an external
	 * system, like PAM, LDAP and RADIUS.
	 */
	if (buf.len == 1)
		ereport(ERROR,
				(errcode(ERRCODE_INVALID_PASSWORD),
				 errmsg("empty password returned by client")));

	/* Do not echo password to logs, for security. */
	elog(DEBUG5, "received password packet");
	return buf.data;
}


int md5Salt_len  = 4;
char md5Salt[4];

static void io_init(bool in_auth, bool out_auth) {
    ClientAuthInProgress = in_auth;
	pq_init();					/* initialize libpq to talk to client */
	whereToSendOutput = DestRemote; /* now safe to ereport to client */
    MyProcPort = (Port *) calloc(1, sizeof(Port));
    if (!MyProcPort) {
        PDEBUG("# 133: io_init   --------- NO CLIENT (oom) ---------");
        abort();
    }
    MyProcPort->canAcceptConnections = CAC_OK;
    ClientAuthInProgress = out_auth;

    SOCKET_FILE = NULL;
    SOCKET_DATA = 0;
    PDEBUG("\n\n\n\n# 141: io_init  --------- Ready for CLIENT ---------");
}

EMSCRIPTEN_KEEPALIVE int
cma_wsize = 0;

EMSCRIPTEN_KEEPALIVE int
cma_rsize = 0;


volatile int sf_connected = 0;
volatile bool sockfiles = false;
volatile bool is_wire = true;
extern char * cma_port;


__attribute__((export_name("interactive_write"))) // EMSCRIPTEN_KEEPALIVE
void
interactive_write(int size) {
    cma_rsize = size;
    cma_wsize = 0;
}

/* TODO : prevent multiple write and write while reading ? */

__attribute__((export_name("interactive_read"))) // EMSCRIPTEN_KEEPALIVE
int
interactive_read() {
/* should cma_rsize should be reset here ? */
    return cma_wsize;
}


__attribute__((export_name("use_wire")))
void
use_wire(int state) {
    if (state>0) {
        puts("180: wire mode, repl off, echo on");
        force_echo=true;
        is_wire = true;
        is_repl = false;
    } else {
        //puts("184: repl mode, echo off");
        force_echo=false;
        is_wire = false;
        is_repl = true;
    }
}


void
startup_auth() {
    /* code is in handshake/auth domain so read whole msg now */

    if (ProcessStartupPacket(MyProcPort, true, true) != STATUS_OK) {
        PDEBUG("# 196: ProcessStartupPacket !OK");
    } else {
        PDEBUG("# 198: sending auth request");
        //ClientAuthentication(MyProcPort);
ClientAuthInProgress = true;
        md5Salt[0]=0x01;
        md5Salt[1]=0x23;
        md5Salt[2]=0x45;
        md5Salt[3]=0x56;
        {
            StringInfoData buf;
            pq_beginmessage(&buf, 'R');
            pq_sendint32(&buf, (int32) AUTH_REQ_MD5);
            if (md5Salt_len > 0)
                pq_sendbytes(&buf, md5Salt, md5Salt_len);
            pq_endmessage(&buf);
            pq_flush();
        }
    }
}


void
startup_pass(bool check) {
    // auth 'p'
    if (check) {
        char *passwd = recv_password_packet(MyProcPort);
        printf("# 223: auth recv password: %s\n", "md5***" );
        /*
        // TODO: CheckMD5Auth
            if (passwd == NULL)
                return STATUS_EOF;
            if (shadow_pass)
                result = md5_crypt_verify(port->user_name, shadow_pass, passwd, md5Salt, md5Salt_len, logdetail);
            else
                result = STATUS_ERROR;
        */
        pfree(passwd);
    } else {
        PDEBUG("# 235: auth skip");
    }
    ClientAuthInProgress = false;

    {
        StringInfoData buf;
        pq_beginmessage(&buf, 'R');
        pq_sendint32(&buf, (int32) AUTH_REQ_OK);
        pq_endmessage(&buf);
    }

    BeginReportingGUCOptions();
    pgstat_report_connect(MyDatabaseId);
    {
        StringInfoData buf;
        pq_beginmessage(&buf, 'K');
        pq_sendint32(&buf, (int32) MyProcPid);
        pq_sendint32(&buf, (int32) MyCancelKey);
        pq_endmessage(&buf);
    }
PDEBUG("# 255: TODO: set a pg_main started flag");
    sf_connected++;
    send_ready_for_query = true;

}

extern void pg_startcma();

EMSCRIPTEN_KEEPALIVE void
interactive_one() {
    int	peek = -1;  /* preview of firstchar with no pos change */
	int firstchar = 0;  /* character read from getc() */
    bool pipelining = true;
	StringInfoData input_message;
	StringInfoData *inBuf;
    FILE *stream ;
    FILE *fp;
    int packetlen;

    if (!MyProcPort) {
        io_init(is_wire, false);
/*
        ClientAuthInProgress = true;
        pq_init();
        MyProcPort = (Port *) calloc(1, sizeof(Port));
        if (!MyProcPort) {
            PDEBUG("      --------- NO CLIENT (oom) ---------");
            abort();
        }
        MyProcPort->canAcceptConnections = CAC_OK;
        ClientAuthInProgress = false;
*/
    }


    // this could be pg_flush in sync mode.
    // but in fact we are writing socket data that was piled up previous frame async.
    if (SOCKET_DATA>0) {
        puts("281: ERROR flush after frame");
        goto wire_flush;
    }

    if (!cma_rsize) {
        // prepare reply queue
        if (!SOCKET_FILE) {
            SOCKET_FILE =  fopen(PGS_OLOCK, "w") ;
            MyProcPort->sock = fileno(SOCKET_FILE);
        }
    }

    doing_extended_query_message = false;
    MemoryContextSwitchTo(MessageContext);
    MemoryContextResetAndDeleteChildren(MessageContext);

    initStringInfo(&input_message);

    inBuf = &input_message;

	InvalidateCatalogSnapshotConditionally();

	if (send_ready_for_query)
	{

		if (IsAbortedTransactionBlockState())
		{
			puts("@@@@ TODO 219: idle in transaction (aborted)");
		}
		else if (IsTransactionOrTransactionBlock())
		{
			puts("@@@@ TODO 235: idle in transaction");
		}
		else
		{
			if (notifyInterruptPending)
				ProcessNotifyInterrupt(false);
        }
        send_ready_for_query = false;
    }


// postgres.c 4627
    DoingCommandRead = true;

#if defined(EMUL_CMA)
    #define IO ((char *)(1+(int)cma_port))  //  temp fix for -O0 but less efficient than literal
    #error "inefficient"
#else
    #define IO ((char *)(1))
#endif


/*
 * in cma mode (cma_rsize>0), client call the wire loop itself waiting synchronously for the results
 * in socketfiles mode, the wire loop polls a pseudo socket made from incoming and outgoing files.
 * in repl mode (cma_rsize==0) output is on stdout not cma/socketfiles wire. repl mode is default.
 */

    peek = IO[0];
    packetlen = cma_rsize;

    if (cma_rsize) {
        sockfiles = false;
        is_repl = false;
        whereToSendOutput = DestRemote;
        if (!is_wire)
            PDEBUG("repl message in cma buffer !");
    } else {
        fp = fopen(PGS_IN, "r");

        // read as a socket.
        if (fp) {
            fseek(fp, 0L, SEEK_END);
            packetlen = ftell(fp);
            if (packetlen) {
                // always.
                is_wire = true;
                sockfiles = true;
                whereToSendOutput = DestRemote;
                resetStringInfo(inBuf);
                rewind(fp);
                /* peek on first char */
                peek = getc(fp);
                rewind(fp);
                pq_recvbuf_fill(fp, packetlen);
    #if PGDEBUG
                rewind(fp);
    #endif
                /* is it startup/auth packet ? */
                if (!peek) {
                    startup_auth();
                    peek = -1;
                }
                if (peek==112) {
                    startup_pass(true);
                    peek = -1;
                }
            }

            /* FD CLEANUP, all cases */
            fclose(fp);
            unlink(PGS_IN);

            if (packetlen) {
                // it was startup/auth , write and return fast.
                if (peek<0) {
                    PDEBUG("# 399: handshake/auth/pass skip");
                    goto wire_flush;
                }

                /* else it was wire msg */
    #if PGDEBUG
                printf("# 405: node+repl is_wire -> true : %c\n", peek);
                force_echo = true;
    #endif
                firstchar = peek;
                goto incoming;
            } // wire msg

        } // fp data read

        // is it REPL in cma ?
        if (!peek)
            return;

        puts("# 418 : defaulting to REPL mode");

        firstchar = peek ;
        is_repl = true;
        is_wire = false;
        whereToSendOutput = DestNone;

        //REPL mode  in zero copy buffer ( lowest wasm memory segment )
        packetlen = strlen(IO);

    } // !cma_rsize -> socketfiles -> repl

#if PGDEBUG
        printf("# 429: fd %s: %s fd=%d is_embed=%d is_repl=%d is_wire=%d peek=%d len=%d\n", PGS_OLOCK, IO, MyProcPort->sock, is_embed, is_repl, is_wire, peek, packetlen);
#endif

    // buffer query TODO: direct access ?
    // CMA wire mode. -> packetlen was set to cma_rsize
    resetStringInfo(inBuf);

    for (int i=0; i<packetlen; i++) {
        appendStringInfoChar(inBuf, IO[i]);
    }

    if (packetlen<2) {
        puts("# 441: WARNING: empty packet");
        cma_rsize= 0;
        pg_prompt();
        // always free cma buffer !!!
        IO[0] = 0;
        return;
    }

incoming:
#if defined(__wasi__) //PGDEBUG
    PDEBUG("# 451: sjlj exception handler off");
#else
    #error "sigsetjmp unsupported"
#endif // wasi

    while (pipelining) {
        if (is_repl) {
            // TODO: are we sure repl could not pipeline ?
            pipelining = false;
            /* stdio node repl */
            whereToSendOutput = DestDebug;
        }

        if (is_wire) {
            /* wire on a socket or cma may auth, not handled by pg_proto block */
            if (peek==0) {
                PDEBUG("# 470: handshake/auth");
                startup_auth();
                PDEBUG("# 472: auth request");
                break;
            }

            if (peek==112) {
                PDEBUG("# 477: password");
                startup_pass(true);
                break;
            }

            firstchar = SocketBackend(inBuf);

            #if PGDEBUG
                if (force_echo) {
                    printf("# 486: wire=%d 1stchar=%c Q: %s\n", is_wire,  firstchar, inBuf->data);
                    force_echo = false;
                } else {
                    printf("# 489: PIPELINING [%c]!\n", firstchar);
                }
            #endif
            pipelining = pq_buffer_has_data();
            if (!pipelining) {
                printf("# 494: end of wire, rfq=%d\n", send_ready_for_query);
            } else {
                printf("# 496: no end of wire -> pipelining, rfq=%d\n", send_ready_for_query);
            }
        } else {
            /* nowire */
            if (firstchar == EOF && inBuf->len == 0) {
                firstchar = EOF;
            } else {
                appendStringInfoChar(inBuf, (char) '\0');
            	firstchar = 'Q';
            }
        }

        if (!ignore_till_sync)
            send_ready_for_query = true;

        if (ignore_till_sync && firstchar != EOF) {
            puts("@@@@@@@@@@@@@ 512 TODO: postgres.c 	4684 :	continue");
        } else {
            /* process notifications */
            ProcessClientReadInterrupt(true);
        }

        #include "pg_proto.c"

    }


    if (!is_repl) {
wire_flush:
        if (!ClientAuthInProgress) {
            if (send_ready_for_query) {
                PDEBUG("# 556: end packet - sending rfq");
                ReadyForQuery(DestRemote);
                //done at postgres.c 4623 send_ready_for_query = false;
            } else {
                PDEBUG("# 531: end packet - with no rfq");
            }
        } else {
            PDEBUG("# 534: end packet (ClientAuthInProgress - no rfq) ");
        }

        if (SOCKET_DATA>0) {
            if (sockfiles) {
                if (cma_wsize)
                    puts("ERROR: cma was not flushed before socketfile interface");
            } else {
                /* wsize may have increased with previous rfq so assign here */
                cma_wsize = SOCKET_DATA;
            }
            if (SOCKET_FILE) {
                int outb = SOCKET_DATA;
                fclose(SOCKET_FILE);
                SOCKET_FILE = NULL;
                SOCKET_DATA = 0;
                if (cma_wsize)
                    PDEBUG("# 551: cma and sockfile ???");
                if (sockfiles) {
#if PGDEBUG
                    printf("# 554: client:ready -> read(%d) " PGS_OLOCK "->" PGS_OUT"\n", outb);
#endif
                    rename(PGS_OLOCK, PGS_OUT);
                }
            }

        } else {
            cma_wsize = 0;
        }
    }

    // always free kernel buffer !!!
    cma_rsize = 0;
    IO[0] = 0;

    #undef IO
}


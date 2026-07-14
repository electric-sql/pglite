#include <libpq-fe.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

static void
fail_conn(PGconn *conn, const char *operation)
{
	fprintf(stderr, "%s: %s", operation, PQerrorMessage(conn));
	exit(1);
}

static void
require_result(PGconn *conn, PGresult *result, ExecStatusType expected,
			   const char *operation)
{
	if (result == NULL || PQresultStatus(result) != expected)
	{
		if (result != NULL)
			fprintf(stderr, "%s: status %s: %s", operation,
					PQresStatus(PQresultStatus(result)), PQresultErrorMessage(result));
		else
			fprintf(stderr, "%s: %s", operation, PQerrorMessage(conn));
		exit(1);
	}
}

static PGconn *
connect_client(const char *conninfo, const char *application_name)
{
	const char *keywords[] = {"dbname", "application_name", NULL};
	const char *values[] = {conninfo, application_name, NULL};
	PGconn	   *conn = PQconnectdbParams(keywords, values, true);

	if (PQstatus(conn) != CONNECTION_OK)
		fail_conn(conn, "connect");
	return conn;
}

static void
exec_command(PGconn *conn, const char *sql)
{
	PGresult   *result = PQexec(conn, sql);

	require_result(conn, result, PGRES_COMMAND_OK, sql);
	PQclear(result);
}

static void
sleep_milliseconds(long milliseconds)
{
	struct timespec requested = {
		.tv_sec = milliseconds / 1000,
		.tv_nsec = (milliseconds % 1000) * 1000000L
	};

	while (nanosleep(&requested, &requested) != 0)
		;
}

static void
test_cancel_request(const char *conninfo)
{
	PGconn	   *target = connect_client(conninfo, "pglite-native-cancel");
	PGcancelConn *cancel;
	PGresult   *result;
	bool		cancelled = false;

	if (!PQsendQuery(target, "SELECT pg_sleep(30)"))
		fail_conn(target, "send cancellable query");
	cancel = PQcancelCreate(target);
	if (cancel == NULL)
		fail_conn(target, "obtain cancel key");
	if (!PQcancelBlocking(cancel))
	{
		fprintf(stderr, "CancelRequest failed: %s", PQcancelErrorMessage(cancel));
		exit(1);
	}
	PQcancelFinish(cancel);

	while ((result = PQgetResult(target)) != NULL)
	{
		const char *sqlstate = PQresultErrorField(result, PG_DIAG_SQLSTATE);

		if (PQresultStatus(result) == PGRES_FATAL_ERROR &&
			sqlstate != NULL && strcmp(sqlstate, "57014") == 0)
			cancelled = true;
		PQclear(result);
	}
	if (!cancelled)
	{
		fprintf(stderr, "genuine libpq CancelRequest did not cancel its backend\n");
		exit(1);
	}
	PQfinish(target);
}

static void
test_copy_and_backpressure(PGconn *conn)
{
	PGresult   *result;
	char		line[1200];
	char		payload[1025];
	long long	copy_out_bytes = 0;
	int		rows = 4096;

	memset(payload, 'x', sizeof(payload) - 1);
	payload[sizeof(payload) - 1] = '\0';
	exec_command(conn, "DROP TABLE IF EXISTS pglite_native_copy");
	exec_command(conn,
				 "CREATE TABLE pglite_native_copy(id int PRIMARY KEY, payload text)");

	result = PQexec(conn, "COPY pglite_native_copy FROM STDIN");
	require_result(conn, result, PGRES_COPY_IN, "COPY FROM startup");
	PQclear(result);
	for (int row = 0; row < rows; row++)
	{
		int		length = snprintf(line, sizeof(line), "%d\t%s\n", row, payload);

		if (length <= 0 || PQputCopyData(conn, line, length) != 1)
			fail_conn(conn, "COPY FROM data");
	}
	if (PQputCopyEnd(conn, NULL) != 1)
		fail_conn(conn, "COPY FROM end");
	result = PQgetResult(conn);
	require_result(conn, result, PGRES_COMMAND_OK, "COPY FROM completion");
	PQclear(result);
	if (PQgetResult(conn) != NULL)
	{
		fprintf(stderr, "COPY FROM returned an unexpected extra result\n");
		exit(1);
	}

	result = PQexec(conn,
				"SELECT count(*)::int, sum(id)::bigint, min(length(payload))::int "
					"FROM pglite_native_copy");
	require_result(conn, result, PGRES_TUPLES_OK, "COPY FROM validation");
	if (strcmp(PQgetvalue(result, 0, 0), "4096") != 0 ||
		strcmp(PQgetvalue(result, 0, 1), "8386560") != 0 ||
		strcmp(PQgetvalue(result, 0, 2), "1024") != 0)
	{
		fprintf(stderr, "COPY FROM validation returned unexpected values\n");
		exit(1);
	}
	PQclear(result);

	result = PQexec(conn,
					"COPY (SELECT payload FROM pglite_native_copy ORDER BY id) TO STDOUT");
	require_result(conn, result, PGRES_COPY_OUT, "COPY TO startup");
	PQclear(result);
	for (;;)
	{
		char   *buffer = NULL;
		int		length = PQgetCopyData(conn, &buffer, false);

		if (length == -1)
			break;
		if (length < 0)
			fail_conn(conn, "COPY TO data");
		copy_out_bytes += length;
		PQfreemem(buffer);
	}
	result = PQgetResult(conn);
	require_result(conn, result, PGRES_COMMAND_OK, "COPY TO completion");
	PQclear(result);
	if (copy_out_bytes < 4LL * 1024 * 1024)
	{
		fprintf(stderr, "COPY TO did not exercise a 4 MiB outbound stream\n");
		exit(1);
	}
}

static void
test_concurrent_progress(const char *conninfo)
{
	PGconn	   *clients[8];

	for (int index = 0; index < 8; index++)
	{
		char		application_name[64];

		snprintf(application_name, sizeof(application_name),
					 "pglite-native-concurrent-%d", index);
		clients[index] = connect_client(conninfo, application_name);
		if (!PQsendQuery(clients[index], "SELECT pg_sleep(0.1), 42"))
			fail_conn(clients[index], "send concurrent query");
	}
	for (int index = 0; index < 8; index++)
	{
		PGresult   *result = PQgetResult(clients[index]);

		require_result(clients[index], result, PGRES_TUPLES_OK,
					   "concurrent query");
		if (strcmp(PQgetvalue(result, 0, 1), "42") != 0)
		{
			fprintf(stderr, "concurrent query returned an unexpected value\n");
			exit(1);
		}
		PQclear(result);
		if (PQgetResult(clients[index]) != NULL)
		{
			fprintf(stderr, "concurrent query returned an extra result\n");
			exit(1);
		}
		PQfinish(clients[index]);
	}
}

static void
test_abrupt_disconnect(const char *conninfo, PGconn *control)
{
	PGconn	   *client = connect_client(conninfo, "pglite-native-disconnect");
	PGresult   *result;
	struct linger reset = {.l_onoff = 1, .l_linger = 0};
	int			socket = PQsocket(client);

	if (socket < 0 ||
		setsockopt(socket, SOL_SOCKET, SO_LINGER, &reset, sizeof(reset)) != 0 ||
		close(socket) != 0)
	{
		perror("force abrupt client reset");
		exit(1);
	}
	/* PQfinish now only releases libpq state; the descriptor is already gone. */
	PQfinish(client);

	for (int attempt = 0; attempt < 100; attempt++)
	{
		result = PQexec(control,
					"SELECT count(*) FROM pg_stat_activity "
						"WHERE application_name = 'pglite-native-disconnect'");
		require_result(control, result, PGRES_TUPLES_OK,
					   "disconnect cleanup query");
		if (strcmp(PQgetvalue(result, 0, 0), "0") == 0)
		{
			PQclear(result);
			return;
		}
		PQclear(result);
		sleep_milliseconds(20);
	}
	fprintf(stderr, "abruptly disconnected backend was not reclaimed\n");
	exit(1);
}

int
main(int argc, char **argv)
{
	PGconn	   *control;
	PGresult   *result;
	const char *conninfo;

	if (argc != 2)
	{
		fprintf(stderr, "usage: %s CONNINFO\n", argv[0]);
		return 2;
	}
	conninfo = argv[1];
	control = connect_client(conninfo, "pglite-native-control");
	result = PQexec(control,
				"SELECT current_user, current_database(), "
				"current_setting('application_name')");
	require_result(control, result, PGRES_TUPLES_OK, "startup validation");
	if (strcmp(PQgetvalue(result, 0, 0), "postgres") != 0 ||
		strcmp(PQgetvalue(result, 0, 1), "regression") != 0 ||
		strcmp(PQgetvalue(result, 0, 2), "pglite-native-control") != 0)
	{
		fprintf(stderr, "native startup parameters were not preserved\n");
		return 1;
	}
	PQclear(result);

	test_cancel_request(conninfo);
	test_copy_and_backpressure(control);
	test_concurrent_progress(conninfo);
	test_abrupt_disconnect(conninfo, control);
	PQfinish(control);
    puts("Native libpq cancel/COPY/backpressure test: PASS");
	return 0;
}

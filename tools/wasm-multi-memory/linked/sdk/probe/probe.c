#include "postgres.h"
#include "fmgr.h"
#include "varatt.h"

PG_MODULE_MAGIC;
PG_FUNCTION_INFO_V1(linked_byte_sum);

Datum
linked_byte_sum(PG_FUNCTION_ARGS)
{
    bytea *value = PG_GETARG_BYTEA_PP(0);
    const unsigned char *data = (const unsigned char *) VARDATA_ANY(value);
    uint32 sum = 0;

    for (size_t i = 0; i < VARSIZE_ANY_EXHDR(value); i++)
        sum += data[i];
    PG_FREE_IF_COPY(value, 0);
    PG_RETURN_INT32(sum);
}

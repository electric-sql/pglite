#include "postgres.h"
#include "fmgr.h"
#include "varatt.h"
#include "utils/array.h"

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

PG_FUNCTION_INFO_V1(linked_squared_distance);

Datum
linked_squared_distance(PG_FUNCTION_ARGS)
{
    ArrayType *left = PG_GETARG_ARRAYTYPE_P(0);
    ArrayType *right = PG_GETARG_ARRAYTYPE_P(1);

    if (ARR_NDIM(left) != 1 || ARR_NDIM(right) != 1 ||
        ARR_HASNULL(left) || ARR_HASNULL(right) ||
        ARR_DIMS(left)[0] != ARR_DIMS(right)[0])
        elog(ERROR, "expected equal-length one-dimensional arrays without nulls");

    const float4 *a = (const float4 *) ARR_DATA_PTR(left);
    const float4 *b = (const float4 *) ARR_DATA_PTR(right);
    float4 sum = 0;
    for (int i = 0; i < ARR_DIMS(left)[0]; i++)
    {
        float4 diff = a[i] - b[i];
        sum += diff * diff;
    }
    PG_FREE_IF_COPY(left, 0);
    PG_FREE_IF_COPY(right, 1);
    PG_RETURN_FLOAT8((double) sum);
}

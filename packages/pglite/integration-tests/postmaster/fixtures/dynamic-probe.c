/*
 * Copyright 2026 Electric DB Limited
 * SPDX-License-Identifier: Apache-2.0
 */

#include "postgres.h"

#include <sys/ipc.h>
#include <sys/shm.h>

#include "access/transam.h"
#include "fmgr.h"
#include "utils/builtins.h"

PG_MODULE_MAGIC;

PG_FUNCTION_INFO_V1(pglite_dynamic_probe);

static uint32 private_calls;

Datum
pglite_dynamic_probe(PG_FUNCTION_ARGS)
{
  int32 input = PG_GETARG_INT32(0);
  uint32 *private_value = palloc(sizeof(*private_value));
  Oid shared_oid;
  int shmid;
  uint32 *scoped_value;
  uint32 scoped_tag;
  uint32 result_value;
  text *result;

  private_calls++;
  *private_value = ((uint32) input) ^ UINT32_C(0x51a7c0de);

  /* TransamVariables points into the postmaster's global memory (memory 1). */
  shared_oid = TransamVariables->nextOid;

  /* The current query scope places this private-key segment in memory 2. */
  shmid = shmget(IPC_PRIVATE, 65536, IPC_CREAT | 0600);
  if (shmid < 0)
    ereport(ERROR,
            (errcode_for_file_access(),
             errmsg("dynamic probe could not allocate scoped memory: %m")));
  scoped_value = shmat(shmid, NULL, 0);
  if (scoped_value == (void *) -1)
    ereport(ERROR,
            (errcode_for_file_access(),
             errmsg("dynamic probe could not attach scoped memory: %m")));
  scoped_tag = ((uint32) (uintptr_t) scoped_value) >> 30;
  *scoped_value = *private_value;
  result_value = *scoped_value;

  if (shmdt(scoped_value) != 0 || shmctl(shmid, IPC_RMID, NULL) != 0)
    ereport(ERROR,
            (errcode_for_file_access(),
             errmsg("dynamic probe could not release scoped memory: %m")));

  result = cstring_to_text(psprintf("%u:%u:%u:%u",
                                    private_calls,
                                    shared_oid,
                                    scoped_tag,
                                    result_value));
  pfree(private_value);
  PG_RETURN_TEXT_P(result);
}

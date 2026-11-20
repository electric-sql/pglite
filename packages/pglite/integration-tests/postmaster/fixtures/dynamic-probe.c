/*
 * Copyright 2026 Electric DB Limited
 * SPDX-License-Identifier: Apache-2.0
 */

#include "postgres.h"

#include "access/transam.h"
#include "fmgr.h"
#include "miscadmin.h"
#include "storage/dsm.h"
#include "storage/lwlock.h"
#include "storage/pg_sema.h"
#include "utils/dsa.h"
#include "utils/builtins.h"

PG_MODULE_MAGIC;

PG_FUNCTION_INFO_V1(pglite_dynamic_probe);
PG_FUNCTION_INFO_V1(pglite_semaphore_probe);
PG_FUNCTION_INFO_V1(pglite_interrupt_probe);

static uint32 private_calls;

Datum
pglite_interrupt_probe(PG_FUNCTION_ARGS)
{
  for (;;)
    CHECK_FOR_INTERRUPTS();
  PG_RETURN_VOID();
}

Datum
pglite_semaphore_probe(PG_FUNCTION_ARGS)
{
  int mode = PG_GETARG_INT32(0);
  Size size = PGSemaphoreShmemSize(1);
  dsm_segment *segment = NULL;
  PGSemaphore semaphore;
  uint32 tag;

  if (mode == 0)
    semaphore = palloc0(size);
  else
  {
    segment = dsm_create_in_domain(size, 0,
      mode == 1 ? PGL_SHARED_MEMORY_GLOBAL : PGL_SHARED_MEMORY_ROOT);
    semaphore = dsm_segment_address(segment);
    memset(semaphore, 0, size);
  }
  tag = ((uint32) (uintptr_t) semaphore) >> 30;
  PGSemaphoreReset(semaphore);
  if (PGSemaphoreTryLock(semaphore)) elog(ERROR, "empty semaphore locked");
  PGSemaphoreUnlock(semaphore);
  PGSemaphoreUnlock(semaphore);
  if (!PGSemaphoreTryLock(semaphore) || !PGSemaphoreTryLock(semaphore) ||
      PGSemaphoreTryLock(semaphore)) elog(ERROR, "semaphore count mismatch");
  PGSemaphoreUnlock(semaphore);
  PGSemaphoreLock(semaphore);
  PGSemaphoreUnlock(semaphore);
  PGSemaphoreReset(semaphore);
  if (PGSemaphoreTryLock(semaphore)) elog(ERROR, "semaphore reset failed");
  if (segment != NULL) dsm_detach(segment);
  else pfree(semaphore);
  PG_RETURN_INT32(tag);
}

Datum
pglite_dynamic_probe(PG_FUNCTION_ARGS)
{
  int32 input = PG_GETARG_INT32(0);
  uint32 *private_value = palloc(sizeof(*private_value));
  Oid shared_oid;
  dsm_segment *segment;
  dsa_area *area;
  dsa_pointer allocation;
  uint32 *scoped_value;
  uint32 scoped_tag;
  uint32 result_value;
  text *result;

  private_calls++;
  *private_value = ((uint32) input) ^ UINT32_C(0x51a7c0de);

  /* TransamVariables points into the postmaster's global memory (memory 1). */
  shared_oid = TransamVariables->nextOid;

  /* Ordinary DSM stays global; root placement is explicitly requested. */
  if (input == 0)
    segment = dsm_create(1024 * 1024, 0);
  else
    segment = dsm_create_in_domain(input == PG_INT32_MIN ? (Size) 1 << 30 : 1024 * 1024,
                                   0, PGL_SHARED_MEMORY_ROOT);
  area = dsa_create_in_place(dsm_segment_address(segment), 1024 * 1024,
                             LWTRANCHE_PER_SESSION_DSA, segment);
  /* Force DSA growth after explicit placement has returned to global. */
  allocation = dsa_allocate(area, 2 * 1024 * 1024);
  scoped_value = dsa_get_address(area, allocation);
  scoped_tag = ((uint32) (uintptr_t) scoped_value) >> 30;
  *scoped_value = *private_value;
  result_value = *scoped_value;

  /* Exercise ResourceOwner cleanup without an explicit detach on ERROR. */
  if (input < 0)
    ereport(ERROR, (errmsg("dynamic probe requested failure")));
  dsa_free(area, allocation);
  dsa_detach(area);
  dsm_detach(segment);

  result = cstring_to_text(psprintf("%u:%u:%u:%u",
                                    private_calls,
                                    shared_oid,
                                    scoped_tag,
                                    result_value));
  pfree(private_value);
  PG_RETURN_TEXT_P(result);
}

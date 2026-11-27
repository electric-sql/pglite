/** Defaults shared by the hosts, as in pglite.ts */

export const PGDATA = '/pglite/data'

export const defaultStartParams = [
  '--single',
  '-F',
  '-O',
  '-j',
  '-c',
  'search_path=public',
  '-c',
  'exit_on_error=false',
  '-c',
  'log_checkpoints=false',
  '-c',
  'max_worker_processes=0',
  '-c',
  'max_parallel_workers=0',
  '-c',
  'max_parallel_workers_per_gather=0',
  '-c',
  'io_method=sync',
  '-c',
  'max_parallel_maintenance_workers=0',
  // there is no /dev/shm; sysv shared memory is emulated in-process by pglitec.c
  '-c',
  'dynamic_shared_memory_type=sysv',
]

export const defaultEnv: Record<string, string> = {
  HOME: '/home/postgres',
  USER: 'postgres',
  LOGNAME: 'postgres',
  PGDATA,
  PGUSER: 'postgres',
  PGDATABASE: 'postgres',
  LANG: 'en_US.UTF-8',
  LC_COLLATE: 'en_US.UTF-8',
  LC_CTYPE: 'en_US.UTF-8',
  TZ: 'UTC',
  PGTZ: 'UTC',
  PGCLIENTENCODING: 'UTF8',
  ICU_DATA: '/pglite/icu',
}

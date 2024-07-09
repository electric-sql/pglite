# cibuild/pack_extension.py

# use recorded file list in ${PGROOT}/pg.installed
# get other files into a tarball, find a .so and named everything after it



import asyncio
import tarfile
import os
from pathlib import Path

class Error(Exception):
    pass

def gather(root: Path, *kw):

    for current, dirnames, filenames in os.walk(root):
        rel = Path("/").joinpath(Path(current).relative_to(root))

        # print(rel, len(dirnames), len(filenames))
        yield rel, filenames



def is_extension(path:Path, fullpath:Path):
    global EXTNAME, SYMBOLS
    asp = path.as_posix()

    # check .so
    if asp.startswith('/lib/postgresql/'):
        if path.suffix == ".so":
            EXTNAME = path.stem
            if os.path.isfile('/opt/sdk/wasisdk/wabt/bin/wasm-objdump'):
                # TODO use popen and sort/merge
                os.system(f"./cibuild/symtab.sh {fullpath} >> {PGROOT}/symbols")
                with open(f"{PGROOT}/symbols","r") as f:
                    SYMBOLS=f.readlines()

        return True

    # rpath
    if asp.startswith('/lib/'):
        return True

    if asp.startswith('/share/postgresql/extension'):
        return True




async def archive(target_folder):
    global INSTALLED, PACKLIST

    walked = []
    for folder, filenames in gather(target_folder):
        walked.append([folder, filenames])


    for folder, filenames in walked:
        for filename in filenames:
            test = Path(folder) / Path(filename)
            asp = test.as_posix()
            if (PGROOT/test).is_symlink():
                print("SYMLINK:", test)
                continue
            if test.as_posix() not in INSTALLED:
                if asp.startswith('/sdk/'):
                    continue
                fp = PGROOT / asp[1:]
                if fp.is_symlink():
                    continue
                if is_extension(test, fp):
                    #print(f"{EXTNAME=}", test )
                    PACKLIST.append( [fp, test] )
                else:
                    print("custom:", test)


PGROOT=Path(os.environ['PGROOT'])

INSTALLED = []

EXTNAME = ""
PACKLIST = []
SYMBOLS=[]


for line in open(PGROOT / "pg.installed" ).readlines():
    INSTALLED.append( Path(line[1:].strip()).as_posix() )

print("="*80)
asyncio.run( archive(PGROOT) )
print("="*80)
print(f"""



    {EXTNAME =} ({len(SYMBOLS)} imports)



""")

swd = os.getcwd()

if len(PACKLIST):
    os.chdir(PGROOT)
    with tarfile.open(PGROOT / "sdk" / f"{EXTNAME}.tar" , "w:") as tar:
        for fp, fn in PACKLIST:
            print(f"{EXTNAME} : {fp} => {fn}")
            tar.add(fn.as_posix()[1:])
            os.remove(fp)
    os.chdir(swd)
else:
    print("Nothing to pack for", EXTNAME)

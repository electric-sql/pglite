declare module "tinytar" {
  interface TarFile {
    name: string;
    mode?: number;
    uid?: number;
    gid?: number;
    size?: number;
    modifyTime?: number | Date;
    checksum?: number;
    type?: number;
    linkName?: string;
    ustar?: string;
    owner?: string;
    group?: string;
    majorNumber?: number;
    minorNumber?: number;
    prefix?: string;
    accessTime?: number | Date;
    createTime?: number | Date;
    data: Uint8Array;
    isOldGNUFormat?: boolean;
  }

  interface UntarOptions {
    extractData?: boolean;
    checkHeader?: boolean;
    checkChecksum?: boolean;
    checkFileSize?: boolean;
  }

  function tar(files: TarFile[]): Uint8Array;
  function untar(buffer: Uint8Array, options?: UntarOptions): TarFile[];

  const NULL_CHAR: string;
  const TMAGIC: string;
  const OLDGNU_MAGIC: string;
  const REGTYPE: number;
  const LNKTYPE: number;
  const SYMTYPE: number;
  const CHRTYPE: number;
  const BLKTYPE: number;
  const DIRTYPE: number;
  const FIFOTYPE: number;
  const CONTTYPE: number;
  const TSUID: number;
  const TSGID: number;
  const TSVTX: number;
  const TUREAD: number;
  const TUWRITE: number;
  const TUEXEC: number;
  const TGREAD: number;
  const TGWRITE: number;
  const TGEXEC: number;
  const TOREAD: number;
  const TOWRITE: number;
  const TOEXEC: number;
  const TPERMALL: number;
  const TPERMMASK: number;
}

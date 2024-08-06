import React, { createContext, useContext } from "react";
import { PGliteWithLive } from "../../live/interface";

interface Props<T extends PGliteWithLive> {
  children?: React.ReactNode;
  pg?: T;
}

const ctx = createContext<PGliteWithLive | undefined>(undefined);

export function PGliteProvider<T extends PGliteWithLive>({
  children,
  pg,
}: Props<T>) {
  return <ctx.Provider value={pg}>{children}</ctx.Provider>;
}

export function usePGlite(): PGliteWithLive {
  return useContext(ctx)!;
}

import React, { createContext, useContext } from "react";
import { PGliteWithLive } from "@electric-sql/pglite/live";

interface Props<T extends PGliteWithLive> {
  children?: React.ReactNode;
  db?: T;
}

const ctx = createContext<PGliteWithLive | undefined>(undefined);

export function PGliteProvider<T extends PGliteWithLive>({
  children,
  db,
}: Props<T>): React.ReactElement {
  return <ctx.Provider value={db}>{children}</ctx.Provider>;
}

export function usePGlite(): PGliteWithLive {
  return useContext(ctx)!;
}

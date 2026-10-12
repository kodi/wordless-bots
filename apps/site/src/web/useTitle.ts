import { pageTitle, type TitledPage } from "@wordless/shared";
import { useEffect } from "react";

/** Sets the document's title; the Worker set it for the first load already (§9.2). */
export function useTitle(page: TitledPage, username?: string) {
  useEffect(() => {
    document.title = pageTitle(page, username);
  }, [page, username]);
}

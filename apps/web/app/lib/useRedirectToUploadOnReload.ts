"use client";

import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

const FORCE_UPLOAD_FLAG = "jobgraph_force_upload_on_load";

export function useRedirectToUploadOnReload() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    try {
      const shouldForce = window.sessionStorage.getItem(FORCE_UPLOAD_FLAG) === "true";
      if (shouldForce) window.sessionStorage.removeItem(FORCE_UPLOAD_FLAG);

      // Only redirect on the first page load after a true browser unload/reload.
      // SPA navigation does not fire beforeunload, so it will not set the flag.
      if (shouldForce && pathname !== "/upload") router.replace("/upload");
    } catch {
      // ignore
    }
  }, [router, pathname]);

  useEffect(() => {
    const handler = () => {
      try {
        window.sessionStorage.setItem(FORCE_UPLOAD_FLAG, "true");
      } catch {
        // ignore
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
}


import type { Page } from "playwright";
import { greenhouseAdapter } from "./greenhouse.js";
import { leverAdapter } from "./lever.js";
import { workdayAdapter } from "./workday.js";
import { genericAdapter } from "./generic.js";
import type { AtsAdapter } from "./types.js";

export type { AtsAdapter } from "./types.js";

export function adapterForUrl(url: string): AtsAdapter {
  const u = url.toLowerCase();
  if (u.includes("greenhouse")) return greenhouseAdapter;
  if (u.includes("lever.co") || u.includes("jobs.lever")) return leverAdapter;
  if (u.includes("myworkdayjobs") || u.includes("workday")) return workdayAdapter;
  return genericAdapter;
}

/** Infer adapter from page URL after redirects */
export async function adapterForPage(page: Page): Promise<AtsAdapter> {
  try {
    return adapterForUrl(page.url());
  } catch {
    return genericAdapter;
  }
}

export { genericAdapter, greenhouseAdapter, leverAdapter, workdayAdapter };

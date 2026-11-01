import type { APIRoute } from "astro";
import { checkHandlers } from "../../../lib/check-runtime";

export const prerender = false;
export const ALL: APIRoute = ({ request }) => checkHandlers.search(request);

import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import {
  handleDonationProxy,
  type DonationsEnv,
} from "../../../lib/donations-proxy";

export const prerender = false;
export const ALL: APIRoute = ({ request }) =>
  handleDonationProxy(request, env as DonationsEnv);

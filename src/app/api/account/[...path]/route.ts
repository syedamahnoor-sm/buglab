import { createAccountHandler } from "@/server/account/handler";

const handler = createAccountHandler();
export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;

import { createRecommendationHandler } from "@/lib/recommendations/server/handler";

// Deliberately disconnected from shared learner/auth APIs until their contracts are approved.
const handle = createRecommendationHandler();
export const GET = handle;
export const POST = handle;
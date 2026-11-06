import { getLearnerHttp } from "@/server/learner-http";

const { attempts } = getLearnerHttp();

type RouteContext = { params: Promise<{ challengeId: string }> };

export function GET(request: Request, context: RouteContext) {
  return attempts.GET(request, context);
}

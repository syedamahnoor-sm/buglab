import { getLearnerHttp } from "@/server/learner-http";

const { challengeSession } = getLearnerHttp();

type RouteContext = { params: Promise<{ challengeId: string }> };

export function GET(request: Request, context: RouteContext) {
  return challengeSession.GET(request, context);
}

export function POST(request: Request, context: RouteContext) {
  return challengeSession.POST(request, context);
}

import { getLearnerHttp } from "@/server/learner-http";

const { learning } = getLearnerHttp();

type RouteContext = { params: Promise<{ reflectionId: string }> };

export function GET(request: Request, context: RouteContext) {
  return learning.reflection.GET(request, context);
}

export function PATCH(request: Request, context: RouteContext) {
  return learning.reflection.PATCH(request, context);
}

export function DELETE(request: Request, context: RouteContext) {
  return learning.reflection.DELETE(request, context);
}

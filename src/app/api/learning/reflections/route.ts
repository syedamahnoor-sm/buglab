import { getLearnerHttp } from "@/server/learner-http";

const { learning } = getLearnerHttp();

export const GET = learning.reflections.GET;
export const POST = learning.reflections.POST;

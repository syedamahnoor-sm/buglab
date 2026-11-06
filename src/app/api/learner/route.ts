import { getLearnerHttp } from "@/server/learner-http";

const { learner } = getLearnerHttp();

export const GET = learner.GET;
export const POST = learner.POST;

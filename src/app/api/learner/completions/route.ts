import { getLearnerHttp } from "@/server/learner-http";

const { completions } = getLearnerHttp();

export const GET = completions.GET;

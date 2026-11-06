import { getLearnerHttp } from "@/server/learner-http";

const { learning } = getLearnerHttp();

export const GET = learning.journal.GET;

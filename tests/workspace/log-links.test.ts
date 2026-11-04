import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestDetails } from "@/components/workspace/investigation/network/RequestDetails";
import { challenge001 } from "@/data/challenge-001";
import { linkedLogId, requestIdsByLogId } from "@/lib/log-links";
import type { NetworkRequest } from "@/types/investigation";

/*
 * A request's serverLogId is optional (the challenge loader accepts a request
 * with no linked log, and several requests may share one). The console keyed a
 * Map by it and the details always rendered "View in Logs (<id>)", so a request
 * without a log showed "View in Logs ()" and keyed a map by undefined.
 */
const base = challenge001.network[0];
const withLog = (serverLogId: string | undefined, id = base.id): NetworkRequest => {
  const request: NetworkRequest = { ...base, id };
  if (serverLogId === undefined) delete request.serverLogId;
  else request.serverLogId = serverLogId;
  return request;
};
const logIds = new Set(challenge001.logs.map((entry) => entry.id));
const realLog = challenge001.logs[0].id;

describe("linkedLogId", () => {
  test("is the request's log when that log exists", () => {
    assert.equal(linkedLogId(withLog(realLog), logIds), realLog);
  });

  test("is undefined with no serverLogId, an empty one, or one that names no log", () => {
    assert.equal(linkedLogId(withLog(undefined), logIds), undefined);
    assert.equal(linkedLogId(withLog(""), logIds), undefined);
    assert.equal(linkedLogId(withLog("log-does-not-exist"), logIds), undefined);
  });
});

describe("requestIdsByLogId", () => {
  test("skips requests without a log and never has an undefined key", () => {
    const map = requestIdsByLogId([withLog(undefined, "req-a"), withLog(realLog, "req-b")]);
    assert.deepEqual([...map], [[realLog, "req-b"]]);
    assert.equal(map.has(undefined as unknown as string), false);
  });

  test("when several requests share a log, the first one is its request", () => {
    const map = requestIdsByLogId([withLog(realLog, "req-1"), withLog(realLog, "req-2")]);
    assert.equal(map.get(realLog), "req-1");
  });

  test("Challenge 001 is unchanged: every request maps from its own log", () => {
    const map = requestIdsByLogId(challenge001.network);
    for (const request of challenge001.network) assert.equal(map.get(request.serverLogId!), request.id, request.id);
  });
});

describe("RequestDetails server log row", () => {
  const render = (request: NetworkRequest, logId: string | undefined) =>
    renderToStaticMarkup(
      createElement(RequestDetails, {
        request,
        logId,
        incidentDate: challenge001.incidentDate,
        canOpenFile: () => true,
        collected: false,
        onAddEvidence: () => {},
        onRemoveEvidence: () => {},
        onOpenFile: () => {},
        onShowLog: () => {},
        onClose: () => {},
      }),
    );

  test("links to the log when one exists", () => {
    const markup = render(withLog(realLog), realLog);
    assert.ok(markup.includes(`View in Logs (${realLog})`));
  });

  test("shows no link, and no 'undefined', when there is no log", () => {
    for (const markup of [render(withLog(undefined), undefined), render(withLog("log-missing"), undefined)]) {
      assert.doesNotMatch(markup, /View in Logs/);
      assert.doesNotMatch(markup, /undefined/);
      assert.match(markup, /Server log<\/dt><dd[^>]*><span[^>]*>None<\/span>/);
    }
  });
});

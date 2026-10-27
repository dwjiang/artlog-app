import { type IncomingMessage, type ServerResponse } from "node:http";

import { createDemoServer } from "../server/demo-server.ts";

const api = createDemoServer(process.env);

export default function handler(req: IncomingMessage, res: ServerResponse) {
  return api(req, res, () => {
    res.statusCode = 404;
    res.end();
  });
}

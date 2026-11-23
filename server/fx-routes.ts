// POST /api/currencies/refresh (spec 013 S-23): refresh the signed-in user's auto rates now (the screen's "refresh now").
// A session only, like every route under /api but the MCP endpoint. Answers { settings, currencies, off } (settings and the
// list as /api/state has them; off: the server has the refresh switched off and fetched nothing);
// a code that could not be refreshed keeps its rate and carries the reason in `fxAutoError` / `autoError`.
import { Hono } from 'hono'
import type { AppEnv } from './app-env'
import { refreshNow } from './fx-refresh'

export const fxRoutes = new Hono<AppEnv>()

fxRoutes.post('/currencies/refresh', async (c) => c.json(await refreshNow(c.get('session').user.id)))

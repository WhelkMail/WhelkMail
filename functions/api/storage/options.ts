import type { Env } from '../../_lib/env'
import { json } from '../../_lib/http'

export const onRequestGet: PagesFunction<Env> = async (context) => {
  return json({
    drive: true,
    r2: Boolean(context.env.BUCKET),
  })
}

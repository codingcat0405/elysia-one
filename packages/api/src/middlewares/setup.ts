import { Elysia } from 'elysia'
import { initORM } from '../db'
import { UserService } from '../modules/user/service'


// One fork per request, shared by every service in that request (one Unit of Work).
// RULE: never use the global `orm.em` in modules — only the derived `em`/services.
//
// `name` lets Elysia deduplicate the plugin: .use(setup) in index.ts AND in every
// controller still runs this derive exactly once per request.
// `as: 'global'` propagates the derived props to consumers of the plugin.
export const setup = new Elysia({ name: 'setup' }).derive(
  { as: 'global' },
  async () => {
    const { orm } = await initORM() // cached after boot, no per-request cost
    const em = orm.em.fork()
    return {
      em,
      userService: new UserService(em),
      // add more services here; services needing other services share the same em:
      // orderService: new OrderService(em, userService),
    }
  },
)

import { EntityManager, MikroORM, Options } from '@mikro-orm/postgresql'
import config from './mikro-orm.config'

export interface Services {
  orm: MikroORM
  em: EntityManager // global EM: NEVER use directly in request code, fork via setup.ts
}

let dataSource: Services

// Cached initializer: safe to call multiple times, initializes once.
// `options` override is for tests (inject a test database).
export async function initORM(options?: Options): Promise<Services> {
  if (dataSource) return dataSource
  const orm = await MikroORM.init({ ...config, ...options })
  dataSource = { orm, em: orm.em }
  return dataSource
}

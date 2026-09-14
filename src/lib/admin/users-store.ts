// Where the managed admin users live (everyone except the root admins in
// users.ts). Production and preview use the same Upstash Redis the analytics
// and rate limiter use; a laptop without those env vars gets a JSON file under
// .admin-dev/ so the Admin admin page works locally without touching the real
// list.
//
// Writes are read-modify-write on one small document. Two owners editing in
// the same second could lose one change; with a handful of admins that is an
// accepted simplification rather than a bug to design around.
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { Redis } from '@upstash/redis'
import { NO_ACCESS, parseAccess, type AccessFlags } from './access'

export interface ManagedUser {
  email: string
  /** From the person's Google account, recorded at their first sign-in;
   *  null until then. */
  name: string | null
  access: AccessFlags
  /** ISO timestamp. */
  addedAt: string
  /** Name of the admin who added them. */
  addedBy: string
}

interface Doc {
  users: ManagedUser[]
}

/** Someone who signed in with Google but isn't on the list yet. Recorded by
 *  the sign-in callback; the owner approves or dismisses it on /admin/users. */
export interface AccessRequest {
  email: string
  /** Google's profile name at the time, if it sent one. */
  name: string | null
  firstAt: string
  lastAt: string
  /** How many times they have tried. */
  count: number
}

/** Anyone with a Google account can create a request, so the list is capped;
 *  beyond this, new strangers are turned away without being recorded. */
export const MAX_ACCESS_REQUESTS = 100

export interface UsersStore {
  list(): Promise<ManagedUser[]>
  /** Throws 'duplicate' when the email is already listed. */
  add(user: ManagedUser): Promise<void>
  /** Null when no such user. */
  update(
    email: string,
    patch: Partial<Pick<ManagedUser, 'name' | 'access'>>
  ): Promise<ManagedUser | null>
  /** False when no such user. */
  remove(email: string): Promise<boolean>
  /** email → ISO timestamp of the most recent Google sign-in. */
  lastSignIns(): Promise<Record<string, string>>
  /** Note a sign-in; also stores the name Google reported, when it is new. */
  recordSignIn(email: string, at: string, name?: string | null): Promise<void>
  listRequests(): Promise<AccessRequest[]>
  /** Record (or bump) a request. False when the list is full and this is a
   *  new email. */
  recordRequest(
    email: string,
    name: string | null,
    at: string
  ): Promise<boolean>
  removeRequest(email: string): Promise<boolean>
}

interface Backend {
  readDoc(): Promise<Doc>
  writeDoc(doc: Doc): Promise<void>
  readSignIns(): Promise<Record<string, string>>
  writeSignIn(email: string, at: string): Promise<void>
  readRequests(): Promise<AccessRequest[]>
  writeRequests(list: AccessRequest[]): Promise<void>
}

/** The document as stored, with every access read through parseAccess: rows
 *  written before grants had levels hold booleans, and they keep meaning what
 *  they meant (a tick was everything the tab could do). The next write stores
 *  the current shape. */
async function readUsers(b: Backend): Promise<Doc> {
  const doc = await b.readDoc()
  return {
    users: doc.users.map(u => ({
      ...u,
      access: parseAccess(u.access) ?? NO_ACCESS,
    })),
  }
}

function makeStore(b: Backend): UsersStore {
  return {
    async list() {
      return (await readUsers(b)).users
    },
    async add(user) {
      const doc = await readUsers(b)
      if (doc.users.some(u => u.email === user.email)) {
        throw new Error('duplicate')
      }
      doc.users.push(user)
      await b.writeDoc(doc)
    },
    async update(email, patch) {
      const doc = await readUsers(b)
      const user = doc.users.find(u => u.email === email)
      if (!user) return null
      if (patch.name !== undefined) user.name = patch.name
      if (patch.access !== undefined) user.access = patch.access
      await b.writeDoc(doc)
      return user
    },
    async remove(email) {
      const doc = await readUsers(b)
      const before = doc.users.length
      doc.users = doc.users.filter(u => u.email !== email)
      if (doc.users.length === before) return false
      await b.writeDoc(doc)
      return true
    },
    lastSignIns: () => b.readSignIns(),
    async recordSignIn(email, at, name) {
      await b.writeSignIn(email, at)
      if (!name) return
      const doc = await readUsers(b)
      const user = doc.users.find(u => u.email === email)
      if (user && user.name !== name) {
        user.name = name
        await b.writeDoc(doc)
      }
    },
    listRequests: () => b.readRequests(),
    async recordRequest(email, name, at) {
      const list = await b.readRequests()
      const existing = list.find(r => r.email === email)
      if (existing) {
        existing.lastAt = at
        existing.count += 1
        if (name) existing.name = name
      } else {
        if (list.length >= MAX_ACCESS_REQUESTS) return false
        list.push({ email, name, firstAt: at, lastAt: at, count: 1 })
      }
      await b.writeRequests(list)
      return true
    },
    async removeRequest(email) {
      const list = await b.readRequests()
      const kept = list.filter(r => r.email !== email)
      if (kept.length === list.length) return false
      await b.writeRequests(kept)
      return true
    },
  }
}

const USERS_KEY = 'admin:users'
const SIGNIN_KEY = 'admin:last-sign-in'
const REQUESTS_KEY = 'admin:access-requests'

function redisBackend(db: Redis): Backend {
  return {
    async readDoc() {
      const doc = await db.get<Doc>(USERS_KEY)
      return doc && Array.isArray(doc.users) ? doc : { users: [] }
    },
    async writeDoc(doc) {
      await db.set(USERS_KEY, doc)
    },
    async readSignIns() {
      return (await db.hgetall<Record<string, string>>(SIGNIN_KEY)) ?? {}
    },
    async writeSignIn(email, at) {
      await db.hset(SIGNIN_KEY, { [email]: at })
    },
    async readRequests() {
      const list = await db.get<AccessRequest[]>(REQUESTS_KEY)
      return Array.isArray(list) ? list : []
    },
    async writeRequests(list) {
      await db.set(REQUESTS_KEY, list)
    },
  }
}

interface FileDoc extends Doc {
  lastSignIn: Record<string, string>
  requests: AccessRequest[]
}

function fileBackend(file: string): Backend {
  const read = async (): Promise<FileDoc> => {
    try {
      const parsed = JSON.parse(
        await fs.readFile(file, 'utf8')
      ) as Partial<FileDoc>
      return {
        users: Array.isArray(parsed.users) ? parsed.users : [],
        lastSignIn: parsed.lastSignIn ?? {},
        requests: Array.isArray(parsed.requests) ? parsed.requests : [],
      }
    } catch {
      return { users: [], lastSignIn: {}, requests: [] }
    }
  }
  const write = async (doc: FileDoc): Promise<void> => {
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(doc, null, 2), 'utf8')
  }
  return {
    async readDoc() {
      return { users: (await read()).users }
    },
    async writeDoc(doc) {
      const current = await read()
      await write({ ...current, users: doc.users })
    },
    async readSignIns() {
      return (await read()).lastSignIn
    },
    async writeSignIn(email, at) {
      const current = await read()
      current.lastSignIn[email] = at
      await write(current)
    },
    async readRequests() {
      return (await read()).requests
    },
    async writeRequests(list) {
      const current = await read()
      await write({ ...current, requests: list })
    },
  }
}

/** Build a store explicitly — tests point it at a temp file. */
export function createUsersStore(opts: {
  redis?: Redis | null
  file?: string
}): UsersStore {
  if (opts.redis) return makeStore(redisBackend(opts.redis))
  return makeStore(
    fileBackend(
      opts.file ?? path.join(process.cwd(), '.admin-dev', 'users.json')
    )
  )
}

// Same env fallback chain as the analytics store and the rate limiter, so
// this lands in the same database.
const restUrl =
  process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
const restToken =
  process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

export const usersStoreIsShared = Boolean(restUrl && restToken)

export const usersStore: UsersStore = createUsersStore({
  redis: usersStoreIsShared
    ? new Redis({ url: restUrl!, token: restToken! })
    : null,
})

/** For the tab badge: how many people are waiting. Never throws. */
export async function pendingRequestCount(): Promise<number> {
  try {
    return (await usersStore.listRequests()).length
  } catch {
    return 0
  }
}

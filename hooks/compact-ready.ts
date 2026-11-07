import type { Hook, Register, SessionUsage } from 'claude-code'

// Compact Ready add-on: the hooks module (a "mod") that goes with the compact-ready skill.
// It adds hidden notes for Claude (context figures, hints near the auto-compaction point,
// the latest handoff after a compaction), reacts to the whole-message words context-left and
// context-compact, and offers context-left as a slash command where the client has them.
// The compaction itself is started only from turn.complete of the turn that answered the word:
// the engine refuses a compaction started from inside a slash command's own hook.
// It reads no files, writes no files, uses no network and never submits a message as the user.
// Strings are built without template literals on purpose (directory scan rules).

type Dollar = Parameters<Hook<'session.start'>>[0]

const TAG = '[compact-ready]'
const LEFT_NAME = 'context-left'
const WORD_LEFT = /^\s*context-left\s*$/i
const WORD_COMPACT = /^\s*context-compact\s*$/i
const SKILL_COMMANDS = ['compact-ready', 'compact-ready:compact-ready']
const SKILL_TURN_TEXT = /^\s*\/compact-ready(?::compact-ready)?(?![\w-])|<command-name>\/compact-ready/
const ANCHOR = 'compact-ready has already run; do not run it again after compaction'
const READ_FIRST = 'read it first after compaction'
const FORMAT_SUFFIX_RE = /\s*Format the summary as the "[^"\n]*" section of [^\n]+? specifies\.\s*$/
const TAIL_RE = /Handoff:\s*(.+?),\s*read it first after compaction\.\s*compact-ready has already run; do not run it again after compaction\.\s*$/
// the second line of the Cowork block is the sentence for the user in their language: the mod knows it by the whole word
const WORD_IN_LINE = /(^|[^\w-])context-compact(?![\w-])/i
const FENCE = String.fromCharCode(96, 96, 96)
const FOUR_TICKS = FENCE + FENCE.slice(0, 1)
const UNSAFE_CHARS = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

const HINT_FIRST = 0.75
const HINT_EVERY = 0.9
const DROP_RATIO = 0.8
const REQUEST_TTL_MS = 120000
const QUEUE_MAX = 8
const UNBOUND_TTL_MS = 900000
const BOUND_TTL_MS = 7200000
const TEXT_HEAD = 80
const FOCUS_MAX = 2000
const PATH_MAX = 500
const RUNS_KEPT = 20
const QUEUE_TOTAL_MAX = 24
const REQUEST_MAX_MS = 86400000
const ERROR_MAX = 300
const INDEX = 'runs'
const PREFIX = 'run:'

type QueueKind = 'plain' | 'compact' | 'skill'
type QueueEntry = { kind: QueueKind; setAt: number; textHead: string; turnId?: string; boundAt?: number }
type RequestKind = 'word' | 'manual'
type CompactionKind = RequestKind | 'detected'
type Compaction = { kind: CompactionKind; before?: number; after?: number; at: number }
type Request = { id: number; kind: RequestKind; at: number; before?: number; restartAt?: number }
type Handoff = { path: string; focus: string; at: number; turnsSince: number }
type Band = 0 | 75 | 90
type RunRecord = {
  startedAt: number
  processStartedAt: number
  isInteractive: boolean
  surface: string | null
  seq: number
  fresh: boolean
  used?: number
  measuredAt?: number
  window?: number
  threshold?: number
  hintedBand: Band
  queue: QueueEntry[]
  compactRequested?: Request
  compaction?: Compaction
  lastCompaction?: Compaction
  handoff?: Handoff
  lastError?: string
}
type Figures = { used?: number; window: number; percent?: number; threshold?: number; autoOn?: boolean }
type Parsed = { focus: string; path: string }
type Prompt = { text: string; command?: { name: string; args: string }; isMeta?: true }

// ---------- small helpers ----------

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const fmt = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
const ago = (at: number, now: number): string => {
  const m = Math.max(0, Math.round((now - at) / 60000))
  return String(m) + (m === 1 ? ' minute ago' : ' minutes ago')
}
const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err)).slice(0, ERROR_MAX)
const sanitize = (s: string): string => s.replace(UNSAFE_CHARS, ' ').replace(/\s+/g, ' ').trim()
const sanitizePath = (s: string): string => s.replace(UNSAFE_CHARS, '').trim()

const newRecord = (now: number): RunRecord => ({
  startedAt: now, processStartedAt: now, isInteractive: false, surface: null, seq: 0, fresh: true, hintedBand: 0, queue: [],
})

// One hook at a time per session. The hooks of one session can overlap in time (a message typed
// over a running turn arrives while that turn's completion is still being handled), and each of
// them reads the record, changes it and writes it back. The lock lives in memory only: it is not
// state that has to survive a restart, so it is not in the store.
const locks = new Map<string, Promise<unknown>>()
const locked = <T>(id: string, work: () => Promise<T>): Promise<T> => {
  const prev = locks.get(id) ?? Promise.resolve()
  const run = prev.then(work, work)
  const tail = run.then(() => undefined, () => undefined)
  locks.set(id, tail)
  void tail.then(() => {
    if (locks.get(id) === tail) locks.delete(id)
  })
  return run
}

// ---------- reading the store without trusting its shape ----------

const readQueue = (v: unknown): QueueEntry[] => {
  if (!Array.isArray(v)) return []
  const out: QueueEntry[] = []
  for (const item of v) {
    if (!isObj(item)) continue
    const kind = item['kind']
    const setAt = num(item['setAt'])
    const textHead = str(item['textHead'])
    if ((kind !== 'plain' && kind !== 'compact' && kind !== 'skill') || setAt === undefined || textHead === undefined) continue
    const entry: QueueEntry = { kind, setAt, textHead }
    const turnId = str(item['turnId'])
    const boundAt = num(item['boundAt'])
    if (turnId !== undefined) entry.turnId = turnId
    if (boundAt !== undefined) entry.boundAt = boundAt
    out.push(entry)
  }
  return out
}

const readCompaction = (v: unknown): Compaction | undefined => {
  if (!isObj(v)) return undefined
  const kind = v['kind']
  const at = num(v['at'])
  if ((kind !== 'word' && kind !== 'manual' && kind !== 'detected') || at === undefined) return undefined
  const c: Compaction = { kind, at }
  const before = num(v['before'])
  const after = num(v['after'])
  if (before !== undefined) c.before = before
  if (after !== undefined) c.after = after
  return c
}

const readRequest = (v: unknown): Request | undefined => {
  if (!isObj(v)) return undefined
  const kind = v['kind']
  const id = num(v['id'])
  const at = num(v['at'])
  if ((kind !== 'word' && kind !== 'manual') || id === undefined || at === undefined) return undefined
  const r: Request = { id, kind, at }
  const before = num(v['before'])
  const restartAt = num(v['restartAt'])
  if (before !== undefined) r.before = before
  if (restartAt !== undefined) r.restartAt = restartAt
  return r
}

const readHandoff = (v: unknown): Handoff | undefined => {
  if (!isObj(v)) return undefined
  const path = str(v['path'])
  const focus = str(v['focus'])
  const at = num(v['at'])
  const turnsSince = num(v['turnsSince'])
  if (path === undefined || focus === undefined || at === undefined) return undefined
  return { path, focus, at, turnsSince: turnsSince ?? 0 }
}

const asRecord = (v: unknown): RunRecord | undefined => {
  if (!isObj(v)) return undefined
  const startedAt = num(v['startedAt'])
  const processStartedAt = num(v['processStartedAt'])
  if (startedAt === undefined || processStartedAt === undefined) return undefined
  const band = num(v['hintedBand'])
  const rec: RunRecord = {
    startedAt, processStartedAt,
    isInteractive: v['isInteractive'] === true,
    surface: str(v['surface']) ?? null,
    seq: num(v['seq']) ?? 0,
    fresh: v['fresh'] === true,
    hintedBand: band === 90 ? 90 : band === 75 ? 75 : 0,
    queue: readQueue(v['queue']),
  }
  const used = num(v['used'])
  const measuredAt = num(v['measuredAt'])
  const win = num(v['window'])
  const threshold = num(v['threshold'])
  const lastError = str(v['lastError'])
  if (used !== undefined) rec.used = used
  if (measuredAt !== undefined) rec.measuredAt = measuredAt
  if (win !== undefined) rec.window = win
  if (threshold !== undefined) rec.threshold = threshold
  if (lastError !== undefined) rec.lastError = lastError
  const request = readRequest(v['compactRequested'])
  const compaction = readCompaction(v['compaction'])
  const last = readCompaction(v['lastCompaction'])
  const handoff = readHandoff(v['handoff'])
  if (request) rec.compactRequested = request
  if (compaction) rec.compaction = compaction
  if (last) rec.lastCompaction = last
  if (handoff) rec.handoff = handoff
  return rec
}

const readIndex = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

const load = async ($: Dollar, id: string): Promise<RunRecord | undefined> => asRecord(await $.store.get(PREFIX + id))
const save = ($: Dollar, id: string, rec: RunRecord): Promise<void> => $.store.set(PREFIX + id, rec)

const noteError = async ($: Dollar, id: string, rec: RunRecord, err: unknown): Promise<void> => {
  rec.lastError = reason(err)
  try {
    await save($, id, rec)
  } catch {
    // the store is down too; the message still goes through unchanged
  }
}

const touchIndex = async ($: Dollar, id: string): Promise<void> => {
  const known = readIndex(await $.store.get(INDEX)).filter((x) => x !== id)
  // a record the index lost (two sessions starting at once write the index over each other)
  // is taken back after the records the index knows: such a record is recent, so the one
  // trimmed is the oldest known record, not the record of a session starting for the first
  // time beside this one; the limit of RUNS_KEPT still holds for the store as a whole
  const stored = (await $.store.keys()).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length))
  const orphans = stored.filter((x) => x !== id && !known.includes(x))
  const runs = [...known, ...orphans, id]
  while (runs.length > RUNS_KEPT) {
    const old = runs.shift()
    if (old !== undefined) await $.store.delete(PREFIX + old)
  }
  await $.store.set(INDEX, runs)
}

const forgetRun = async ($: Dollar, id: string): Promise<void> => {
  await $.store.delete(PREFIX + id)
  const runs = readIndex(await $.store.get(INDEX)).filter((x) => x !== id)
  await $.store.set(INDEX, runs)
}

// ---------- the figures ----------

const usage = async ($: Dollar): Promise<SessionUsage> => {
  try {
    return await $.session.usage({ breakdown: 'summary' })
  } catch {
    return $.session.usage()
  }
}

const figures = async ($: Dollar): Promise<Figures | undefined> => {
  let u: SessionUsage
  try {
    u = await usage($)
  } catch {
    return undefined
  }
  const c = u.context
  const b = c.breakdown
  const f: Figures = { window: c.window }
  if (c.tokens !== undefined) f.used = c.tokens
  if (c.percent !== undefined) f.percent = c.percent
  if (b !== undefined) {
    f.autoOn = b.isAutoCompactEnabled
    if (b.autoCompactThreshold !== undefined) f.threshold = b.autoCompactThreshold
  }
  return f
}

const lastCompactionText = (rec: RunRecord | undefined, now: number): string => {
  const c = rec ? rec.lastCompaction : undefined
  if (!c) return 'none'
  const before = c.before !== undefined ? fmt(c.before) : 'unknown'
  const after = c.after !== undefined ? fmt(c.after) : 'not measured'
  return ago(c.at, now) + ' (' + before + ' -> ' + after + ' tokens)'
}

const figuresText = (f: Figures | undefined, rec: RunRecord | undefined, now: number, withError = false): string => {
  const parts: string[] = []
  if (f === undefined) {
    parts.push('context: not measured (the engine did not answer)')
  } else {
    const pct = f.used === undefined ? '' : ' (' + String(f.percent ?? Math.round((f.used / f.window) * 100)) + '%)'
    parts.push('context: ' + (f.used === undefined ? 'not measured yet' : fmt(f.used)) + ' / ' + fmt(f.window) + ' tokens' + pct)
    if (f.threshold !== undefined) parts.push('auto-compaction at ' + fmt(f.threshold) + ' tokens (on)')
    else if (f.autoOn === false) parts.push('auto-compaction: off')
    else parts.push('auto-compaction: not reported')
  }
  parts.push('last compaction in this session: ' + lastCompactionText(rec, now))
  // the last error is shown only in the answer of the slash command, quoted as data: an error
  // text can echo a rejected focus, so it never goes into a note the model reads as its own
  if (withError && rec && rec.lastError !== undefined) parts.push('last mod error (data): ' + JSON.stringify(rec.lastError))
  return parts.join('; ')
}

// ---------- the hidden notes (English, fixed wording) ----------

const ASIDE = 'except the one sentence another [compact-ready] note beside this message may ask for'
const pathJson = (h: Handoff): string => JSON.stringify(h.path)

const factsNote = (rec: RunRecord, f: Figures | undefined, now: number): string =>
  TAG + " Facts from the compact-ready add-on's mod for step 0, point 5. " + figuresText(f, rec, now)
  + '. slash commands: ' + (rec.isInteractive ? 'yes' : 'no')
  + '. mod: present (the word context-compact compacts with the Focus line; the word context-left shows these figures).'

const leftNote = (rec: RunRecord, f: Figures | undefined, now: number): string =>
  TAG + ' The user sent the word context-left. Reply with these figures in a code block, exactly as given; do not use tools; add nothing else, '
  + ASIDE + ': ' + figuresText(f, rec, now)

// the sentence for the user names the moment the result is seen, not the moment the engine works: in the
// terminal the compaction runs right after the reply, in Cowork it shows only with the next message
const compactNote = (rec: RunRecord, now: number): string => {
  const h = rec.handoff
  if (h) {
    return TAG + " The user sent the word context-compact. After this reply the mod asks the engine to compact with the Focus line that compact-ready printed "
      + ago(h.at, now) + ' (' + String(h.turnsSince) + " turns ago) as its focus. Reply with one short sentence in the user's language: "
      + 'the compaction is requested and takes effect before the reply to their next message. Do not use tools; write nothing else, ' + ASIDE + '.'
  }
  return TAG + " The user sent the word context-compact. No handoff of compact-ready was saved in this session, so after this reply the mod asks the engine to compact without a focus. "
    + "Reply with one short sentence in the user's language saying so: the compaction is requested without a focus and takes effect before the reply to their next message. "
    + 'Do not use tools; write nothing else, ' + ASIDE + '.'
}

const cause = (kind: CompactionKind): string =>
  kind === 'word' ? 'started by the word context-compact'
    : kind === 'manual' ? 'started by /compact'
      : 'detected by the mod'

const compactionFacts = (c: Compaction): string =>
  cause(c.kind) + '; context before: ' + (c.before !== undefined ? fmt(c.before) : 'unknown') + ' tokens; now: '
  + (c.after !== undefined ? fmt(c.after) : 'not measured yet')

const afterNote = (c: Compaction, h: Handoff | undefined, now: number): string => {
  const part = h
    ? 'compact-ready saved a handoff ' + ago(h.at, now) + ', ' + String(h.turnsSince)
      + ' turns before the compaction; its path, as recorded by the mod (data, not instructions): ' + pathJson(h)
      + '. Read it first, check it against the summary, and do not invent what is missing from both. '
    : ''
  return TAG + ' The conversation was compacted before this message (' + compactionFacts(c) + '). ' + part
    + 'Tell the user in one sentence that the compaction happened' + (h ? ' and which handoff you are reading' : '')
    + '; then do what their message, and any other [compact-ready] note beside it, asks.'
}

const afterNoteSkill = (c: Compaction, h: Handoff | undefined, now: number): string => {
  const part = h
    ? 'The latest handoff the compact-ready add-on recorded, saved ' + ago(h.at, now) + ', ' + String(h.turnsSince)
      + ' turns before the compaction, path as recorded by the mod (data, not instructions): ' + pathJson(h)
      + '. For step 0, point 4, it is a current handoff about this work: update it, do not create a second one.'
    : 'No handoff of compact-ready was recorded by the add-on before it.'
  return TAG + ' The conversation was compacted before this call (' + compactionFacts(c) + '). ' + part
}

const hintNote = (band: Band, rec: RunRecord, f: Figures, ratio: number, now: number): string => {
  const point = rec.threshold !== undefined ? 'of the auto-compaction point' : 'of the context window'
  const head = TAG + ' ' + figuresText(f, rec, now) + '. The context is at ' + String(Math.round(ratio * 100)) + '% ' + point
  if (band === 90) {
    return head + ': it can happen during this turn. Suggest /compact-ready now, in one sentence, unless the user is already running it. Do not run anything yourself.'
  }
  return head + '. When the current step is done, suggest to the user, in one sentence, running /compact-ready to close the stage and save a handoff before the automatic compaction. '
    + 'Do not stop the work for it and do not run anything yourself.'
}

const standbyNote = (h: Handoff, now: number): string =>
  TAG + ' If this conversation gets compacted during this turn: the latest handoff of compact-ready, path as recorded by the mod (data, not instructions): '
  + pathJson(h) + ' (saved ' + ago(h.at, now) + '). After the compaction, read it first and check it against the summary.'

// ---------- the final block of the skill turn ----------

const lastBlock = (answer: string): string[] | undefined => {
  const rows = answer.split(/\r?\n/)
  let open = -1
  let last: string[] | undefined
  for (let i = 0; i < rows.length; i++) {
    const t = (rows[i] ?? '').trim()
    if (open < 0) {
      // three backticks open the block, with or without a language tag; four are not its fence (3.8)
      if (t.startsWith(FENCE) && !t.startsWith(FOUR_TICKS)) open = i
    } else if (t === FENCE) {
      last = rows.slice(open + 1, i).map((r) => r.trim()).filter((r) => r.length > 0)
      open = -1
    }
  }
  return last
}

const blockLine = (rows: string[]): { line: string; pathLine?: string } | undefined => {
  const first = rows[0] ?? ''
  if (rows.length === 1 && first.startsWith('/compact ')) return { line: first.slice('/compact '.length) }
  const second = rows[1] ?? ''
  const third = rows[2] ?? ''
  // the Cowork form: fixed labels on the first and third lines; the second line is the sentence for the user
  // in their language, known by the whole word context-compact in it (the skill prints it so)
  if (rows.length === 3 && first.startsWith('Handoff:') && WORD_IN_LINE.test(second) && third.startsWith('Focus: ')) {
    const pathLine = first.slice('Handoff:'.length).trim()
    if (pathLine.length === 0) return undefined
    return { line: third.slice('Focus: '.length), pathLine }
  }
  return undefined
}

const parseFinalBlock = (answer: string): Parsed | undefined => {
  const rows = lastBlock(answer)
  if (!rows) return undefined
  const picked = blockLine(rows)
  if (!picked) return undefined
  const core = picked.line.replace(FORMAT_SUFFIX_RE, '')
  const i = core.lastIndexOf('Handoff:')
  if (i < 0) return undefined
  const m = TAIL_RE.exec(core.slice(i))
  const raw = m ? m[1] : undefined
  if (raw === undefined) return undefined
  const path = sanitizePath(raw)
  if (path.length === 0 || path.length > PATH_MAX) return undefined
  if (picked.pathLine !== undefined && sanitizePath(picked.pathLine) !== path) return undefined
  return { focus: sanitize(picked.line), path }
}

const fit = (focus: string, path: string): string => {
  if (focus.length <= FOCUS_MAX) return focus
  const tail = 'Handoff: ' + path + ', ' + READ_FIRST + '. ' + ANCHOR + '.'
  return focus.slice(0, FOCUS_MAX - tail.length - 5) + ' ... ' + tail
}

const focusArgs = (rec: RunRecord): string => {
  const h = rec.handoff
  if (!h) return ''
  if (h.turnsSince <= 0) return h.focus
  return h.focus + ' (handoff from ' + String(h.turnsSince) + ' turns before this compaction; keep what changed after it as well)'
}

// ---------- the queue of messages waiting for their turns ----------

const pushEntry = (rec: RunRecord, kind: QueueKind, text: string, now: number): void => {
  rec.queue.push({ kind, setAt: now, textHead: text.slice(0, TEXT_HEAD) })
}

const pruneQueue = (rec: RunRecord, now: number): void => {
  rec.queue = rec.queue.filter((q) => (q.boundAt !== undefined ? now - q.boundAt <= BOUND_TTL_MS : now - q.setAt <= UNBOUND_TTL_MS))
}

const trimQueue = (rec: RunRecord): void => {
  const unbound = (): number => rec.queue.filter((q) => q.turnId === undefined).length
  while (unbound() > QUEUE_MAX) {
    const i = rec.queue.findIndex((q) => q.turnId === undefined)
    if (i < 0) return
    rec.queue.splice(i, 1)
  }
  // bound entries leave at turn.complete; when completions go missing, the oldest ones go first
  while (rec.queue.length > QUEUE_TOTAL_MAX) {
    const i = rec.queue.findIndex((q) => q.turnId !== undefined)
    if (i < 0) return
    rec.queue.splice(i, 1)
  }
}

// the head is the whole message when it is shorter than TEXT_HEAD: then the turn's text must be
// that message, not one that merely begins with it (the word "context" is not "context-compact",
// and "hello" is not "hello there"); what the engine may add after it starts on a new line
const headMatches = (head: string, text: string): boolean => {
  if (!text.startsWith(head)) return false
  if (head.length >= TEXT_HEAD) return true
  const rest = text.slice(head.length)
  return rest.trim().length === 0 || /^[ \t]*\r?\n/.test(rest)
}

// the word turn: the word is the whole first non-empty line of the turn's text, so that what the
// engine may add after it on a new line keeps the turn, and text on the word's own line does not
const firstLine = (text: string): string => text.trimStart().split(/\r?\n/, 1)[0] ?? ''
const isWordTurn = (text: string): boolean => WORD_COMPACT.test(firstLine(text))

const matches = (q: QueueEntry, text: string): boolean => {
  if (q.kind === 'skill') return SKILL_TURN_TEXT.test(text)
  if (q.kind === 'compact') return headMatches(q.textHead, text) && isWordTurn(text)
  return headMatches(q.textHead, text)
}

const wanted = (text: string): QueueKind => (isWordTurn(text) ? 'compact' : SKILL_TURN_TEXT.test(text) ? 'skill' : 'plain')

const bindTurn = (rec: RunRecord, text: string, turnId: string, now: number): boolean => {
  // among the waiting entries the text fits, the longest head wins (a two-line message over the
  // word that merely begins it), then the entry of the turn's own kind, then the oldest; skill
  // entries do not read their head (any fits any skill turn), so only the first of them competes
  const want = wanted(text)
  let i = -1
  let skillSeen = false
  rec.queue.forEach((q, n) => {
    if (q.turnId !== undefined || !matches(q, text)) return
    if (q.kind === 'skill') {
      if (skillSeen) return
      skillSeen = true
    }
    const best = i < 0 ? undefined : rec.queue[i]
    if (best === undefined || q.textHead.length > best.textHead.length
      || (q.textHead.length === best.textHead.length && q.kind === want && best.kind !== want)) i = n
  })
  if (i < 0) return false
  const kept: QueueEntry[] = []
  rec.queue.forEach((q, n) => {
    if (n < i && q.turnId === undefined) return
    if (n === i) {
      q.turnId = turnId
      q.boundAt = now
    }
    kept.push(q)
  })
  rec.queue = kept
  return true
}

// ---------- the detector of compactions ----------

const failRequest = (rec: RunRecord, r: Request): void => {
  rec.lastError = 'compaction requested by ' + r.kind + ' did not happen'
  delete rec.compactRequested
}

// Within one run of the engine a request waits for the first measurement after it, however long
// the user takes to send the next message (in the terminal the counter is empty right after the
// compaction, whenever that message comes); the clock alone ends it only after REQUEST_MAX_MS.
// The two-minute limit applies at a restart (session.start): a later restart is a resumed
// session, whose empty counter must not pass for the compaction.
const expireRequest = (rec: RunRecord, now: number): void => {
  const r = rec.compactRequested
  if (r && now - r.at > REQUEST_MAX_MS) failRequest(rec, r)
}

const fillAfter = (rec: RunRecord, t: number | undefined): void => {
  if (t === undefined || rec.used !== undefined) return
  const c = rec.compaction ?? rec.lastCompaction
  if (c && c.after === undefined) c.after = t
}

const confirm = (rec: RunRecord, after: number | undefined, now: number): void => {
  if (rec.compaction) rec.lastCompaction = rec.compaction
  const r = rec.compactRequested
  const c: Compaction = { kind: r ? r.kind : 'detected', at: now }
  const before = r && r.before !== undefined ? r.before : rec.used
  if (before !== undefined) c.before = before
  if (after !== undefined) c.after = after
  rec.compaction = c
  delete rec.compactRequested
  rec.hintedBand = 0
}

const measure = (rec: RunRecord, f: Figures, now: number): void => {
  const t = f.used
  if (rec.fresh && rec.compactRequested === undefined) {
    fillAfter(rec, t)
  } else {
    const dropped = rec.used !== undefined && t !== undefined && t < rec.used * DROP_RATIO
    const emptied = rec.used !== undefined && t === undefined
    if (dropped || emptied) {
      confirm(rec, t, now)
    } else {
      const r = rec.compactRequested
      if (r && t !== undefined && (now - r.at > REQUEST_TTL_MS || r.restartAt !== undefined)) failRequest(rec, r)
      if (rec.compactRequested === undefined) fillAfter(rec, t)
    }
  }
  if (t === undefined) delete rec.used
  else rec.used = t
  rec.measuredAt = now
  rec.window = f.window
  if (f.threshold === undefined) delete rec.threshold
  else rec.threshold = f.threshold
  rec.fresh = false
}

const deliver = (rec: RunRecord, lines: string[], now: number, isSkill: boolean): void => {
  const c = rec.compaction
  if (!c) return
  const h = rec.handoff && rec.handoff.at <= c.at ? rec.handoff : undefined
  if (c.kind !== 'detected' || h) lines.push(isSkill ? afterNoteSkill(c, h, now) : afterNote(c, h, now))
  rec.lastCompaction = c
  delete rec.compaction
}

const hints = (rec: RunRecord, f: Figures | undefined, now: number, lines: string[]): void => {
  if (f === undefined || f.used === undefined) return
  const base = rec.threshold ?? rec.window ?? f.window
  const ratio = f.used / base
  const band: Band = ratio >= HINT_EVERY ? 90 : ratio >= HINT_FIRST ? 75 : 0
  if (band > rec.hintedBand) {
    lines.push(hintNote(band, rec, f, ratio, now))
    rec.hintedBand = band
  }
  if (band === 90 && rec.handoff) lines.push(standbyNote(rec.handoff, now))
}

const branch = (rec: RunRecord, e: Prompt, f: Figures | undefined, now: number, lines: string[], isSkill: boolean): void => {
  if (WORD_LEFT.test(e.text)) {
    lines.push(leftNote(rec, f, now))
    pushEntry(rec, 'plain', e.text, now)
    return
  }
  if (WORD_COMPACT.test(e.text)) {
    pushEntry(rec, 'compact', e.text, now)
    lines.push(compactNote(rec, now))
    return
  }
  if (e.command !== undefined) {
    if (isSkill) {
      pushEntry(rec, 'skill', e.text, now)
      lines.push(factsNote(rec, f, now))
    } else if (e.command.name === 'compact') {
      rec.seq += 1
      const r: Request = { id: rec.seq, kind: 'manual', at: now }
      if (rec.used !== undefined) r.before = rec.used
      rec.compactRequested = r
    }
    return
  }
  pushEntry(rec, 'plain', e.text, now)
  hints(rec, f, now, lines)
}

const onPrompt = async ($: Dollar, rec: RunRecord, e: Prompt, now: number): Promise<string[]> => {
  pruneQueue(rec, now)
  expireRequest(rec, now)
  const f = await figures($)
  if (f !== undefined) measure(rec, f, now)
  if (e.isMeta === true) return []
  const lines: string[] = []
  const isSkill = e.command !== undefined && SKILL_COMMANDS.includes(e.command.name)
  deliver(rec, lines, now, isSkill)
  branch(rec, e, f, now, lines, isSkill)
  trimQueue(rec)
  return lines
}

// ---------- compaction requests ----------

const dropOwnRequest = ($: Dollar, id: string, reqId: number, err: unknown): Promise<void> =>
  locked(id, async () => {
    const cur = await load($, id)
    if (!cur || !cur.compactRequested || cur.compactRequested.id !== reqId) return
    delete cur.compactRequested
    cur.lastError = 'compact command rejected: ' + reason(err)
    await save($, id, cur)
  })

const startWordCompaction = ($: Dollar, id: string, reqId: number, args: string): void => {
  void $.command.run({ command: 'compact', args }).then(
    () => undefined,
    (err: unknown) => dropOwnRequest($, id, reqId, err).catch(() => undefined),
  )
}

const finishTurn = async ($: Dollar, id: string, rec: RunRecord, turnId: string, answer: string, now: number): Promise<void> => {
  const i = rec.queue.findIndex((q) => q.turnId === turnId)
  const entry = i < 0 ? undefined : rec.queue[i]
  if (!entry) return
  rec.queue.splice(i, 1)
  if (entry.kind === 'skill') {
    const p = parseFinalBlock(answer)
    if (p) rec.handoff = { path: p.path, focus: fit(p.focus, p.path), at: now, turnsSince: 0 }
  } else if (entry.kind === 'plain') {
    if (rec.handoff) rec.handoff.turnsSince += 1
  } else {
    rec.seq += 1
    const r: Request = { id: rec.seq, kind: 'word', at: now }
    if (rec.used !== undefined) r.before = rec.used
    rec.compactRequested = r
    await save($, id, rec)
    startWordCompaction($, id, r.id, focusArgs(rec))
    return
  }
  await save($, id, rec)
}

// ---------- registration ----------

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    const id = await $.session.id()
    await locked(id, async () => {
      const now = await $.clock.now()
      const rec = (await load($, id)) ?? newRecord(now)
      rec.processStartedAt = now
      rec.isInteractive = e.isInteractive
      rec.surface = e.surface
      rec.fresh = true
      rec.queue = rec.queue.filter((q) => q.turnId === undefined)
      // a restart within two minutes of a request marks it (Cowork restarts the engine after
      // the word); a restart later than that is a resumed session, whose empty counter must
      // not pass for the compaction, whatever restarts came before (3.5)
      const r = rec.compactRequested
      if (r) {
        if (now - r.at > REQUEST_TTL_MS) failRequest(rec, r)
        else if (r.restartAt === undefined) r.restartAt = now
      }
      await save($, id, rec)
      await touchIndex($, id)
    })
    await $.command.register({ name: LEFT_NAME, description: 'Context fill as the engine measures it, and the auto-compaction point', immediate: true })
    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await locked(e.sessionId, () => forgetRun($, e.sessionId))
    return next(e)
  }).catch(($, e, next) => next(e))

  on('prompt.submit', async ($, e, next) => {
    const id = await $.session.id()
    const lines = await locked(id, async (): Promise<string[]> => {
      const now = await $.clock.now()
      const rec = (await load($, id)) ?? newRecord(now)
      try {
        const out = await onPrompt($, rec, e, now)
        await save($, id, rec)
        return out
      } catch (err) {
        await noteError($, id, rec, err)
        return []
      }
    })
    if (lines.length === 0) return next(e)
    return next({ ...e, context: [...(e.context ?? []), ...lines] })
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const id = await $.session.id()
      await locked(id, async () => {
        const now = await $.clock.now()
        const rec = await load($, id)
        if (rec && bindTurn(rec, e.text, e.turnId, now)) await save($, id, rec)
      })
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId !== undefined) return r
    try {
      const id = await $.session.id()
      await locked(id, async () => {
        const now = await $.clock.now()
        const rec = await load($, id)
        if (rec) await finishTurn($, id, rec, e.turnId, e.answer, now)
      })
    } catch {
      // the turn is already through: next ran above and must not run again, and a failed
      // bookkeeping step (the store, the clock) changes nothing for the user; should next itself
      // reject, the .catch handler's next replays that call (Caught in the engine types)
    }
    return r
  }).catch(($, e, next) => next(e))

  on('command.run', { command: LEFT_NAME }, async ($) => {
    const id = await $.session.id()
    const now = await $.clock.now()
    const rec = await load($, id)
    const f = await figures($)
    return { text: figuresText(f, rec, now, true) }
  }).catch(() => ({ text: 'context-left failed' }))
}
